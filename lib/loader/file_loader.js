'use strict';

const assert = require('assert');
const fs = require('fs');
const debug = require('debug')('egg-core:loader');
const path = require('path');
const globby = require('globby');
const is = require('is-type-of');
const deprecate = require('depd')('egg');
const utils = require('../utils');
const FULLPATH = Symbol('EGG_LOADER_ITEM_FULLPATH');
const EXPORTS = Symbol('EGG_LOADER_ITEM_EXPORTS');

const defaults = {
  directory: null,
  target: null,
  match: undefined,
  ignore: undefined,
  lowercaseFirst: false,
  caseStyle: 'camel',
  initializer: null,
  call: true,
  override: false,
  inject: undefined,
  filter: null,
};

/**
 * Load files from directory to target object.
 * 将options.directory目录下所有文件exports加载到target上。
 * @since 1.0.0
 */
class FileLoader {

  /**
   * @constructor
   * @param {Object} options - options
   * @param {String|Array} options.directory - directories to be loaded ep: app/controller/home.js or [app/controller, app/services]
   * @param {Object} options.target - attach the target object from loaded files
   * @param {String} options.match - match the files when load, support glob, default to all js files
   * @param {String} options.ignore - ignore the files when load, support glob
   * @param {Function} options.initializer - custom file exports, receive two parameters, first is the inject object(if not js file, will be content buffer), second is an `options` object that contain `path`
   * @param {Boolean} options.call - determine whether invoke when exports is function
   * @param {Boolean} options.override - determine whether override the property when get the same name
   * @param {Object} options.inject - an object that be the argument when invoke the function
   * @param {Function} options.filter - a function that filter the exports which can be loaded
   * @param {String|Function} options.caseStyle - set property's case when converting a filepath to property list.
   */
  constructor(options) {
    assert(options.directory, 'options.directory is required');
    assert(options.target, 'options.target is required');
    this.options = Object.assign({}, defaults, options);

    // compatible old options _lowercaseFirst_
    if (this.options.lowercaseFirst === true) {
      deprecate('lowercaseFirst is deprecated, use caseStyle instead');
      this.options.caseStyle = 'lower';
    }
  }

  /**
   * attach items to target object. Mapping the directory to properties.
   * `app/controller/group/repository.js` => `target.group.repository`
   * @return {Object} target
   * @since 1.0.0
   */
  load() {
    // 绝对路径、路径组成的数组和文件exports组成
    // item: [{ fullpath, properties, exports }, { fullpath, properties, exports }]
    const items = this.parse();
    // 加载的对象
    const target = this.options.target;
    for (const item of items) {
      debug('loading item %j', item);
      // item { properties: [ 'a', 'b', 'c'], exports }
      // => target.a.b.c = exports
      /**
         * 迭代，首先处理target.a
         * target[a] = target[a] || {}
         * 依次至最后一项
         * 如果最后一项已经有了值且options.override设置不允许覆盖报错
         * 最后一项无值或可以覆盖
         * 最后一项（target.a.b.c）为item.exports
         * target.a.b.c = item.exports
         * target.a.b.c[FULLPATH] = item.fullpath;
         * target.a.b.c[EXPORTS] = true;
          */


      item.properties.reduce((target, property, index) => {
        let obj;
        const properties = item.properties.slice(0, index + 1).join('.');
        if (index === item.properties.length - 1) {
          if (property in target) {
            if (!this.options.override) throw new Error(`can't overwrite property '${properties}' from ${target[property][FULLPATH]} by ${item.fullpath}`);
          }
          obj = item.exports;
          if (obj && !is.primitive(obj)) {
            obj[FULLPATH] = item.fullpath;
            obj[EXPORTS] = true;
          }
        } else {
          obj = target[property] || {};
        }
        target[property] = obj;
        debug('loaded %s', properties);
        return obj;
      }, target);
    }
    return target;
  }

  /**
   * Parse files from given directories, then return an items list, each item contains properties and exports.
   *
   * For example, parse `app/controller/group/repository.js`
   *
   * ```
   * module.exports = app => {
   *   return class RepositoryController extends app.Controller {};
   * }
   * ```
   *
   * It returns a item
   *
   * ```
   * {
   *   properties: [ 'group', 'repository' ],
   *   exports: app => { ... },
   * }
   * ```
   *
   * `Properties` is an array that contains the directory of a filepath.
   *
   * `Exports` depends on type, if exports is a function, it will be called. if initializer is specified, it will be called with exports for customizing.
   * @return {Array} items [{ fullpath, properties, exports }, { fullpath, properties, exports }]
   * @since 1.0.0
   */
  parse() {
    // 有match字段时，仅加载match字段内文件
    let files = this.options.match;
    if (!files) {
      // 支持typescript时需加载ts文件
      files = (process.env.EGG_TYPESCRIPT === 'true' && require.extensions['.ts'])
        ? [ '**/*.(js|ts)', '!**/*.d.ts' ]
        : [ '**/*.js' ];
    } else {
      files = Array.isArray(files) ? files : [ files ];
    }

    // 忽略的文件，在忽略的文件名前加！后，加入files数组
    let ignore = this.options.ignore;
    if (ignore) {
      ignore = Array.isArray(ignore) ? ignore : [ ignore ];
      ignore = ignore.filter(f => !!f).map(f => '!' + f);
      files = files.concat(ignore);
    }
    // 目录
    let directories = this.options.directory;
    if (!Array.isArray(directories)) {
      directories = [ directories ];
    }

    const filter = is.function(this.options.filter) ? this.options.filter : null;
    const items = [];
    debug('parsing %j', directories);
    // 遍历所有数组
    for (const directory of directories) {
      // 获取整个目录下所有文件，以directory为根目录
      // 类似sync(['src/**/*.js', '!src/**/*.spec.js'])，会去除以！开头的文件
      // 返回filepath组成的数组
      const filepaths = globby.sync(files, { cwd: directory });
      for (const filepath of filepaths) {
        // filepath的完整目录
        const fullpath = path.join(directory, filepath);
        // fullpath非文件跳出
        if (!fs.statSync(fullpath).isFile()) continue;
        // get properties
        // app/service/foo/bar.js => ["foo", "bar"] filepath。当前目录下相对路径的转换
        // 将文件路径分解为数组，并根据options中caseStyle的值设置文件名的首字母是否大小写
        const properties = getProperties(filepath, this.options);
        // app/service/foo/bar.js => service.foo.bar
        const pathName = directory.split(/[/\\]/).slice(-1) + '.' + properties.join('.');
        // get exports from the file
        const exports = getExports(fullpath, this.options, pathName);

        // ignore exports when it's null or false returned by filter function
        if (exports == null || (filter && filter(exports) === false)) continue;

        // set properties of class
        // 为class增加pathName和绝对路径属性。
        if (is.class(exports)) {
          exports.prototype.pathName = pathName;
          exports.prototype.fullPath = fullpath;
        }
        // 每一项有绝对路径、路径组成的数组和文件exports组成
        items.push({ fullpath, properties, exports });
        debug('parse %s, properties %j, export %j', fullpath, properties, exports);
      }
    }
    return items;
  }

}

module.exports = FileLoader;
module.exports.EXPORTS = EXPORTS;
module.exports.FULLPATH = FULLPATH;

// convert file path to an array of properties
// a/b/c.js => ['a', 'b', 'c']
function getProperties(filepath, { caseStyle }) {
  // if caseStyle is function, return the result of function
  if (is.function(caseStyle)) {
    const result = caseStyle(filepath);
    assert(is.array(result), `caseStyle expect an array, but got ${result}`);
    return result;
  }
  // use default camelize
  return defaultCamelize(filepath, caseStyle);
}

// Get exports from filepath
// If exports is null/undefined, it will be ignored
function getExports(fullpath, { initializer, call, inject }, pathName) {
  // 类似require（fullpath)
  let exports = utils.loadFile(fullpath);
  // process exports as you like
  // controller加载时使用

  if (initializer) {
    exports = initializer(exports, { path: fullpath, pathName });
  }

  // return exports when it's a class or generator
  //
  // module.exports = class Service {};
  // or
  // module.exports = function*() {}
  if (is.class(exports) || is.generatorFunction(exports) || is.asyncFunction(exports)) {
    return exports;
  }

  // return exports after call when it's a function
  //
  // module.exports = function(app) {
  //   return {};
  // }
  if (call && is.function(exports)) {
    exports = exports(inject);
    if (exports != null) {
      return exports;
    }
  }

  // return exports what is
  return exports;
}

/**
 *
 * @param filepath ep: app/service/foo/bar.js
 * @param caseStyle
 * @returns {string[]} ep: ["app", "service", "foo", "bar"]
 */

function defaultCamelize(filepath, caseStyle) {
  // ["app", "service", "foo", "bar"]
  const properties = filepath.substring(0, filepath.lastIndexOf('.')).split('/');
  return properties.map(property => {
    if (!/^[a-z][a-z0-9_-]*$/i.test(property)) {
      throw new Error(`${property} is not match 'a-z0-9_-' in ${filepath}`);
    }

    // use default camelize, will capitalize the first letter
    // foo_bar.js > FooBar
    // fooBar.js  > FooBar
    // FooBar.js  > FooBar
    // FooBar.js  > FooBar
    // FooBar.js  > fooBar (if lowercaseFirst is true)

    // 将_或者-去掉并将后一位字母大写
    property = property.replace(/[_-][a-z]/ig, s => s.substring(1).toUpperCase());
    let first = property[0];
    switch (caseStyle) {
      case 'lower':
        first = first.toLowerCase();
        break;
      case 'upper':
        first = first.toUpperCase();
        break;
      case 'camel':
      default:
    }
    return first + property.substring(1);
  });
}
