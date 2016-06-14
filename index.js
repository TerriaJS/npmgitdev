#!/usr/bin/env node
var fs = require('fs');
var Git = require('nodegit');
var path = require('path');
var spawnSync = require('child_process').spawnSync;

function forEachPackage(directory, callback) {
    var nodeModules = path.join(directory, 'node_modules');

    if (!fs.existsSync(nodeModules)) {
        return;
    }

    var packages = fs.readdirSync(nodeModules);
    packages.forEach(function(packageName) {
        var packagePath = path.join(nodeModules, packageName);
        callback(packageName, packagePath);
        forEachPackage(packagePath, callback);
    });
}

var rootDir = path.resolve('.');
var tempDir = fs.mkdtempSync(path.join(rootDir, 'npmgitdev-'));

var promises = [];

if (process.argv.length === 2) {
    console.log('npmgitdev is a wrapper around npm, so it uses exactly the same arguments. See the README. Try `npmgitdev install`');
    process.exit(1);
}

function output(s) {
    console.log('[npmgitdev] ' + s);
}


forEachPackage(rootDir, function(packageName, packagePath) {
    var gitDir = path.join(packagePath, '.git');
    if (!fs.existsSync(gitDir)) {
        return;
    }

    var stat = fs.lstatSync(packagePath);
    if (stat.isSymbolicLink()) {
        output('Skipping symlinked package: ' + packagePath);
        return;
    }

    var targetDir = path.join(tempDir, packageName);
    var createdTargetPath = false;
    if (fs.existsSync(targetDir)) {
        targetDir = fs.mkdtempSync(tempDir, packageName + '-');
        createdTargetPath = true;
    }

    var promise = Git.Repository.open(packagePath).then(function(repo) {
        var hasUncommittedChanges = false;
        var messages = [];
        return Git.Status.foreach(repo, function(file, status) {
            if (status !== Git.Status.STATUS.IGNORED) {
                hasUncommittedChanges = true;
                var statusTexts = Object.keys(Git.Status.STATUS).filter(function(key) {return Git.Status.STATUS[key] & status;});
                messages.push('    * ' + file + ': ' + statusTexts.join(', '));
            }
        }).then(function(config) {
            repo.free();

            var packageJson = readPackageJson(packagePath);

            return {
                hasUncommittedChanges: hasUncommittedChanges,
                messages: messages,
                packageName: packageName,
                packagePath: packagePath,
                original: gitDir,
                renamed: targetDir,
                createdRenamedPath: createdTargetPath,
                version: packageJson.version
            };
        });
    });

    promises.push(promise);
});

Promise.all(promises).then(function(mappings) {
    var mappingsPath = path.join(tempDir, 'mappings.json');
    fs.writeFileSync(mappingsPath, JSON.stringify(mappings, undefined, '  '));

    var uncommittedPackages = mappings.filter(function(mapping) { return mapping.hasUncommittedChanges; });
    if (uncommittedPackages.length > 0) {
        output('The following packages have uncommitted changes:');
        uncommittedPackages.forEach(function(mapping) {
            output('  ' + mapping.packagePath);
            output(mapping.messages.join('\n'));
        });
        output('Please ensure all packages with a git repository have a clean working directory.')
    }

    var i = 0;
    var mapping;
    var rootPackageJsonText;

    if (uncommittedPackages.length === 0) {
        // Temporarily each git directory's version to the root package.json.
        // That way npm won't get clever and "upgrade" it.
        rootPackageJsonText = readPackageJsonText(rootDir);
        var rootPackageJson = JSON.parse(rootPackageJsonText);

        rootPackageJson.dependencies = rootPackageJson.dependencies || {};
        mappings.forEach(function(mapping) {
            rootPackageJson.dependencies[mapping.packageName] = mapping.version;
            if (rootPackageJson.devDependencies) {
                delete rootPackageJson.devDependencies[mapping.packageName];
            }
        });

        writePackageJson(rootDir, rootPackageJson);

        try {
            for (i = 0; i < mappings.length; ++i) {
                mapping = mappings[i];
                output('Moving ' + mapping.original + ' to ' + mapping.renamed);
                fs.renameSync(mapping.original, mapping.renamed);

                var packageJsonPath = path.join(mapping.packagePath, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    var originalPackageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
                    var originalPackageJson = JSON.parse(originalPackageJsonText);
                    if (originalPackageJson.devDependencies) {
                        output('Temporarily adding devDependencies to dependencies in ' + packageJsonPath);
                        mapping.originalPackageJsonText = originalPackageJsonText;
                        mapping.packageJsonPath = packageJsonPath;
                        var newPackageJson = Object.assign({}, originalPackageJson);
                        newPackageJson.dependencies = Object.assign({}, newPackageJson.dependencies || {}, newPackageJson.devDependencies);
                        fs.writeFileSync(packageJsonPath, JSON.stringify(newPackageJson, undefined, '  '));
                    }
                }
            }
        } catch(e) {
            output(e);
        }
    }

    if (i === mappings.length) {
        try {
            var passargs = process.argv.slice(2);
            output('Running `npm ' + passargs.join(' ') + '`)');
            var result = spawnSync('npm', passargs, {
                stdio: 'inherit',
                shell: true
            });
            output('npm finished');
        } catch (e) {
            output(e);
        }
    }

    // Restore original root package.json.
    if (rootPackageJsonText) {
        writePackageJsonText(rootDir, rootPackageJsonText);
    }

    var errors = false;
    var j;
    for (j = 0; j < i; ++j) {
        mapping = mappings[j];
        if (mapping.originalPackageJsonText) {
            output('Restoring original ' + mapping.packageJsonPath);
            fs.writeFileSync(mapping.packageJsonPath, mapping.originalPackageJsonText);
        }
        output('Returning ' + mapping.renamed + ' to ' + mapping.original);
        try {
            fs.renameSync(mapping.renamed, mapping.original);
        } catch(e) {
            output('** Error while renaming ' + mapping.renamed + ' back to ' + mapping.original);
            errors = true;
        }
    }

    for (j = i; j < mappings.length; ++j) {
        mapping = mappings[j];
        if (mapping.createdRenamedPath) {
            try {
                fs.rmdirSync(mapping.renamed);
            } catch(e) {
                output('** Error while removing ' + mapping.renamed);
                errors = true;
            }
        }
    }

    if (!errors) {
        fs.unlinkSync(mappingsPath);
        fs.rmdirSync(tempDir);
    }
}).catch(function(e) {
    output(e);
    output(e.stack);
});

function readPackageJsonText(packagePath) {
    var packageJsonPath = path.join(packagePath, 'package.json');
    return fs.readFileSync(packageJsonPath, 'utf8');
}

function readPackageJson(packagePath) {
    return JSON.parse(readPackageJsonText(packagePath));
}

function writePackageJsonText(packagePath, text) {
    var packageJsonPath = path.join(packagePath, 'package.json');
    fs.writeFileSync(packageJsonPath, text);
}

function writePackageJson(packagePath, json) {
    writePackageJsonText(packagePath, JSON.stringify(json, undefined, '  '));
}