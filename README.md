# npmgitdev

npmgitdev a wrapper around `npm` version 3+ that allows you to work with git repos cloned directly into node_modules.

When we're developing modular software, we often need to edit multiple separate npm packages simultaneously.  The "official" way to do this is with `npm link`.  We clone a separate repo for each package, and then link it into the appropriate places.  The problem is, `npm link` creates all sorts of complexities and bugs.

It would be nice if we could avoid all this complexity by simply cloning a repo into `node_modules`.  Unfortunately, `npm install` will bail (refuse to do anything) when it detects a `.git` directory inside any package in node_modules.  This is a problem because it forces us to use `npm link` to develop modular software, which comes with a whole host of complexities and bugs.

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
