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
var tempDir = fs.mkdtempSync(path.join(rootDir, 'ginstall-'));

var promises = [];

forEachPackage(rootDir, function(packageName, packagePath) {
    var gitDir = path.join(packagePath, '.git');
    if (!fs.existsSync(gitDir)) {
        return;
    }

    var stat = fs.lstatSync(packagePath);
    if (stat.isSymbolicLink()) {
        console.log('Skipping symlinked package: ' + packagePath);
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
        return Git.Status.foreach(repo, function(file, status) {
            if (status !== Git.Status.STATUS.IGNORED) {
                hasUncommittedChanges = true;
            }
        }).then(function(config) {
            repo.free();

            var packageJson = readPackageJson(packagePath);

            return {
                hasUncommittedChanges: hasUncommittedChanges,
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
    var uncommittedPackages = mappings.filter(function(mapping) { return mapping.hasUncommittedChanges; });
    if (uncommittedPackages.length > 0) {
        console.log('The following packages have uncommitted changes:');
        uncommittedPackages.forEach(function(mapping) {
            console.log('  ' + mapping.packagePath);
        });
        console.log('Please ensure all packages with a git repository have a clean working directory.')
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
                console.log('Moving ' + mapping.original + ' to ' + mapping.renamed);
                fs.renameSync(mapping.original, mapping.renamed);

                var packageJsonPath = path.join(mapping.packagePath, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    var originalPackageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
                    var originalPackageJson = JSON.parse(originalPackageJsonText);
                    if (originalPackageJson.devDependencies) {
                        console.log('Temporarily adding devDependencies to dependencies in ' + packageJsonPath);
                        mapping.originalPackageJsonText = originalPackageJsonText;
                        mapping.packageJsonPath = packageJsonPath;
                        var newPackageJson = Object.assign({}, originalPackageJson);
                        newPackageJson.dependencies = Object.assign({}, newPackageJson.dependencies || {}, newPackageJson.devDependencies);
                        fs.writeFileSync(packageJsonPath, JSON.stringify(newPackageJson, undefined, '  '));
                    }
                }
            }
        } catch(e) {
            console.log(e);
        }
    }

    if (i === mappings.length) {
        try {
            console.log('Starting npm');
            var result = spawnSync('npm', process.argv.slice(2), {
                stdio: 'inherit',
                shell: true
            });
            console.log('Done npm');
        } catch (e) {
            console.log(e);
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
            console.log('Restoring original ' + mapping.packageJsonPath);
            fs.writeFileSync(mapping.packageJsonPath, mapping.originalPackageJsonText);
        }
        console.log('Returning ' + mapping.renamed + ' to ' + mapping.original);
        try {
            fs.renameSync(mapping.renamed, mapping.original);
        } catch(e) {
            console.log('** Error while renaming ' + mapping.renamed + ' back to ' + mapping.original);
            errors = true;
        }
    }

    for (j = i; j < mappings.length; ++j) {
        mapping = mappings[j];
        if (mapping.createdRenamedPath) {
            try {
                fs.rmdirSync(mapping.renamed);
            } catch(e) {
                console.log('** Error while removing ' + mapping.renamed);
                errors = true;
            }
        }
    }

    if (!errors) {
        fs.rmdirSync(tempDir);
    }
}).catch(function(e) {
    console.log(e);
    console.log(e.stack);
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