# npmgitdev

npmgitdev a wrapper around `npm` version 3+ that allows you to work with git repos cloned directly into node_modules.

When we're developing modular software, we often need to edit multiple separate npm packages simultaneously.  The "official" way to do this is with `npm link`.  We clone a separate repo for each package, and then link it into the appropriate places.  The problem is, `npm link` creates all sorts of complexities and bugs.

It would be nice if we could avoid all this complexity by simply cloning a repo into `node_modules`.  Unfortunately, `npm install` will bail (refuse to do anything) when it detects a `.git` directory inside any package in node_modules.

`npmgitdev` avoids this problem by:

* Ensuring that all git repos are clean (have no changes in the working directory or index), so that if npm decides to replace the package you won't lose any work.
* Temporarily changing the required version to match the one specified in the git repo's package.json, so npm is not inclined to mess with it.
* Temporarily copying all `devDependencies` of git packages to `dependencies`, because you'll probably need them while you're developing your git package.
* Hiding the `.git` directory temporarily while invoking an npm command.
* Cleaning up all the temporary changes after the git command completes.

Installation:

```
npm install -g npmgitdev
```

Usage:

```
# in your project's directory
cd node_modules
git clone https://github.com/TerriaJS/terriajs # or whatever repo you want to work with inside your project
cd ..

# later, or whenever you want:
npmgitdev install
```

The end result is that npm installs packages exactly as it would if you copied all your `devDependencies` to `dependencies` and then published the package to npm.  npm's package deduplication actually works, unlike with `npm link`!

If you accidentally run `npm install` instead, it should be harmless because `npm` will bail when it sees your `.git` directory.

## Questions and Answers

> What happens if my git package is referenced from multiple other packages in my dependency tree?

Generally, you should clone your git package into the top-level `node_modules` directory of your application.  Then, `npmgitdev` will ensure that npm keeps it there by adding a dependency in the top-level `package.json` to that exact version of the package.  If other packages elsewhere in the dependency tree depend on a semver-compatible version of that package, npm 3's deduplication wil avoid installing any other copies of that package elsewhere in the tree.

However, if other packages depend on an _incompatible_ version of that package, or if their dependency is to a Git URL or something else other than a version, npm _will_ install additional copies.  If you instead intended for all packages to share the Git repo version of the package, you simply need to delete the extra copies that npm installed.  Use `npmgitdev list <package name>` to see what versions exist in your dependency tree.

## Dependencies
NPM >= 3 and Node >= 5.10.0
