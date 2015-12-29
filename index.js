var Promise = require('bluebird');
var fs = require('fs');
var path = require('path');
var exists = fs.existsSync;
var write = fs.writeFileSync;
var read = function(filepath) {
  return fis.util.read(filepath);
};
var rVariable = /\$\{([\w\.\-_]+)(?:\s(.*?))?\}/g;
var child_process = require('child_process');

exports.name = 'init';
exports.usage = '<template>';
exports.desc = 'scaffold with specifed template.';

exports.register = function(commander) {
  var Scaffold = require('fis-scaffold-kernel');
  var scaffold;

  commander
    .option('-r, --root <path>', 'set project root')
    .option('--token <token>', 'private token')
    // .option('-R, --repos <path>', 'set repos path')
    .action(function(template) {
      var args = [].slice.call(arguments);
      var options = args.pop();

      var settings = {
        root: options.root || '',
        token: options.token,
        template: args[0] || 'default',
        version: 1,
        onCollectVariables: null,
        onVaraiblesResolved: null,
        onContentReplace: null,
        onReplaced: null
      };

      // 根据 fis-conf.js 确定 root 目录
      Promise.try(function() {
        if (!settings.root) {
          var findup = require('findup');

          return new Promise(function(resolve, reject) {
            var fup = findup(process.cwd(), 'fis-conf.js');
            var dir = null;

            fup.on('found', function(found) {
              dir = found;
              fup.stop();
            });

            fup.on('error', reject);

            fup.on('end', function() {
              resolve(dir);
            });
          })

          .then(function(dir) {
            settings.root = dir || process.cwd();
          });
        }
      })

      // load fis-conf.js if exists.
      // 读取用户配置信息。
      // .then(function() {
      //   var filepath = path.resolve(settings.root, 'fis-conf.js');

      //   if (exists(filepath)) {
      //     require(filepath);
      //   }
      // })

      // downloading...
      .then(function() {
        fis.log.info('Dir: %s', settings.root);

        return new Promise(function(resolve, reject) {
          var SimpleTick = require('./lib/tick.js');
          var bar;

          var repos = settings.template;
          var type = fis.config.get('scaffold.type', 'github');
          var idx = repos.indexOf(':');

          if (~idx) {
            type = repos.substring(0, idx);
            repos = repos.substring(idx + 1);
          }

          if (!~repos.indexOf('/')) {
            repos = fis.config.get('scaffold.namespace', 'fis-scaffold') + '/' + repos;
          }

          var token = fis.config.get('scaffold.token', settings.token || '');

          function progress() {
            bar = bar || new SimpleTick('downloading `' + repos + '` ');
            bar.tick();
          }

          scaffold = new Scaffold({
            type: type,
            repos: options.repos,
            log: {
              level: 0
            }
          });
          scaffold.download(repos, function(error, location) {
            if (error) {
              return reject(error);
            }

            bar.clear();
            resolve(location)
          }, progress, {token: token});
        });
      })

      .then(function(tempdir) {
        var script =  path.join(tempdir, '.scaffold.js');

        if (exists(script)) {
          try {
            require(script)(settings);
          } catch(e) {}

          scaffold.util.del(script);

          if (settings.version > 1) {
            rVariable =  /\$\{\{([\w\.\-_]+)(?:\s+(.+?))?\}\}/g;
          }
        }

        return tempdir;
      })

      // collect variables.
      .then(function(tempdir) {
        var files = scaffold.util.find(tempdir);
        var variables = {};

        files.forEach(function(filename) {
          var m;

          while ((m = rVariable.exec(filename))) {
            variables[m[1]] = variables[m[1]] || m[2];
          }

          var contents = read(filename);

          if (typeof contents !== 'string') {
            return;
          }

          while ((m = rVariable.exec(contents))) {
            variables[m[1]] = variables[m[1]] || m[2];
          }
        });

        settings.onCollectVariables && settings.onCollectVariables(variables);

        return {
          files: files,
          variables: variables,
          dir: tempdir
        };
      })

      // prompt
      .then(function(info) {
        var schema = [];
        var variables = info.variables;

        Object.keys(variables).forEach(function(key) {
          schema.push({
            name: key,
            required: variables[key] !== '::empty',
            'default': variables[key] === '::empty' ? '' : variables[key]
          });
        });

        if (schema.length) {
          return new Promise(function(resolve, reject) {
            scaffold.prompt(schema, function(error, result) {
              if (error) {
                return reject(error);
              }

              info.variables = result;
              resolve(info);
            });
          });
        }

        settings.onVaraiblesResolved && settings.onVaraiblesResolved(info.variables, info);

        return info;
      })


      // replace
      .then(function(info) {
        var files = info.files;
        var variables = info.variables;

        files.forEach(function(filepath) {
          var contents = read(filepath);

          if (typeof contents !== 'string') {
            return;
          }

          contents = contents.replace(rVariable, function(_, key) {
            return variables[key];
          });

          settings.onContentReplace && (contents = settings.onContentReplace(contents, filepath))

          write(filepath, contents);
        });

        settings.onReplaced && settings.onReplaced(info);
        return info;
      })

      // deliver
      .then(function(info) {
        var files = info.files;
        var root = info.dir;
        var variables = info.variables;
        var roadmap = [];

        files.forEach(function(filepath) {
          if (rVariable.test(filepath)) {
            var pattern = filepath.substring(root.length);
            var resolved = pattern.replace(rVariable, function(_, key) {
              return variables[key];
            });

            roadmap.push({
              reg: pattern,
              release: resolved
            });
          }
        });

        roadmap.push({
          reg: /^\/readme\.md/i,
          release: false
        });

        roadmap.push({
          reg: /^.*$/i,
          release: '$0'
        });

        scaffold.deliver(root, settings.root, roadmap);
        return info;
      })

      // npm install
      .then(function(info) {
        var packageJson = path.join(settings.root, 'package.json');

        if (exists(packageJson)) {
          var config = require(packageJson);

          if (config.dependencies || config.devDependencies) {
            // run `npm install`
            return new Promise(function(resolve, reject) {
              scaffold.prompt([{
                name: 'Run `npm install`?',
                'default': 'y'
              }], function(error, result) {
                if (error) {
                  return reject(error);
                }

                if (/^\s*y\s*$/.test(result['Run `npm install`?'])) {
                  var spawn = child_process.spawn;
                  console.log('npm install');

                  var npm = process.platform === "win32" ? "npm.cmd" : "npm";
                  var install = spawn(npm, ['install'], {
                    cwd: settings.root
                  });
                  install.stdout.pipe(process.stdout);
                  install.stderr.pipe(process.stderr);

                  install.on('error', function(reason) {
                    reject(reason);
                  });

                  install.on('close', function() {
                    resolve(info);
                  });
                } else {
                  resolve(info);
                }

              });
            });
          }
        }

        return info;
      })

      // fis install
      .then(function(info) {
        var json = path.join(settings.root, 'component.json');

        if (exists(json)) {
          var config = require(json);

          // run `npm install`
          return new Promise(function(resolve, reject) {
            scaffold.prompt([{
                name: 'Run `fis3 install`?',
                'default': 'y'
              }], function(error, result) {
                if (error) {
                  return reject(error);
                }

                if (/^\s*y\s*$/.test(result['Run `fis3 install`?'])) {
                  var spawn = child_process.spawn;
                  console.log('npm install');

                  var spawn = child_process.spawn;
                  console.log('Installing components...');

                  var install = spawn(process.execPath, [process.argv[1], 'install']);
                  install.stdout.pipe(process.stdout);
                  install.stderr.pipe(process.stderr);

                  install.on('error', function(reason) {
                    reject(reason);
                  });

                  install.on('close', function() {
                    resolve(info);
                  });
                } else {
                  resolve(info);
                }
            });
          });
        }

        return info;
      })

      .then(function(info) {
        var script =  path.join(settings.root, '.build.sh');

        if (exists(script)) {
          return new Promise(function(resolve, reject) {
            scaffold.prompt([{
                name: 'Run `.build.sh`?',
                'default': 'y'
              }], function(error, result) {
                if (error) {
                  return reject(error);
                }

                if (/^\s*y\s*$/.test(result['Run `.build.sh`?'])) {
                  var spawn = child_process.spawn;
                  console.log('sh .build.sh');

                  var build = spawn('sh', ['.build.sh'], {
                    cwd: settings.root
                  });
                  build.stdout.pipe(process.stdout);
                  build.stderr.pipe(process.stderr);

                  build.on('error', function(reason) {
                    scaffold.util.del(script);
                    reject(reason);
                  });

                  build.on('close', function() {
                    scaffold.util.del(script);
                    resolve(info);
                  });
                } else {
                  scaffold.util.del(script);
                  resolve(info);
                }
            });
          });
        }

        return info;
      })

      .then(function(info) {
        console.log('\nDone!');
      });

    });
};
