'use strict';

const join = require('path').join;
const is = require('is-type-of');
const inspect = require('util').inspect;
const assert = require('assert');
const debug = require('debug')('egg-core:middleware');
const pathMatching = require('egg-path-matching');
const utils = require('../../utils');


module.exports = {

  /**
   * Load app/middleware
   *
   * app.config.xx is the options of the middleware xx that has same name as config
   *
   * @method EggLoader#loadMiddleware
   * @param {Object} opt - LoaderOptions
   * @example
   * ```js
   * // app/middleware/status.js
   * module.exports = function(options, app) {
   *   // options == app.config.status
   *   return function*(next) {
   *     yield next;
   *   }
   * }
   * ```
   * @since 1.0.0
   */
  loadMiddleware(opt) {
    this.timing.start('Load Middleware');
    const app = this.app;

    // load middleware to app.middleware
    opt = Object.assign({
      call: false,
      override: true,
      caseStyle: 'lower',
      directory: this.getLoadUnits().map(unit => join(unit.path, 'app/middleware')),
    }, opt);
    const middlewarePaths = opt.directory;
    // 将各个加载单元app/middleware文件夹中的文件exports出的文件加载到app.middlewares对象中。
    this.loadToApp(middlewarePaths, 'middlewares', opt);
    // 获取app.middleware中的中间件时桥接到app.middlewares上。
    for (const name in app.middlewares) {
      Object.defineProperty(app.middleware, name, {
        get() {
          return app.middlewares[name];
        },
        enumerable: false,
        configurable: false,
      });
    }

    this.options.logger.info('Use coreMiddleware order: %j', this.config.coreMiddleware);
    this.options.logger.info('Use appMiddleware order: %j', this.config.appMiddleware);

    // use middleware ordered by app.config.coreMiddleware and app.config.appMiddleware
    // config中的middleware字段
    const middlewareNames = this.config.coreMiddleware.concat(this.config.appMiddleware);
    debug('middlewareNames: %j', middlewareNames);
    const middlewaresMap = new Map();
    // 循环config文件中的middleware字段
    for (const name of middlewareNames) {
      // app.middlewares中没有该name的中间件就返回
      if (!app.middlewares[name]) {
        throw new TypeError(`Middleware ${name} not found`);
      }
      // 该中间件已加载过，也返回
      if (middlewaresMap.has(name)) {
        throw new TypeError(`Middleware ${name} redefined`);
      }
      // 记录已加载
      middlewaresMap.set(name, true);

      /**
         *  config[name] 格式
         *  config.mongoose = {
         *  url: 'mongodb://127.0.0.1:27017/todo',
         *  options: {}, 该中间件的配置文件
         *  };
         * @type {*|{}}
         */
      const options = this.config[name] || {};
      let mw = app.middlewares[name];
      // 以options、app为参数运行app.middlewares[name]。返回的是一个async函数
      mw = mw(options, app);
      assert(is.function(mw), `Middleware ${name} must be a function, but actual is ${inspect(mw)}`);
      mw._name = name;
      // middlewares support options.enable, options.ignore and options.match
      mw = wrapMiddleware(mw, options);
      if (mw) {
        app.use(mw);
        debug('Use middleware: %s with options: %j', name, options);
        this.options.logger.info('[egg:loader] Use middleware: %s', name);
      } else {
        this.options.logger.info('[egg:loader] Disable middleware: %s', name);
      }
    }

    this.options.logger.info('[egg:loader] Loaded middleware from %j', middlewarePaths);
    this.timing.end('Load Middleware');
  },

};

function wrapMiddleware(mw, options) {
  // support options.enable
  if (options.enable === false) return null;

  // support generator function
  mw = utils.middleware(mw);

  // support options.match and options.ignore
  // 如果没有match和ignore直接返回mw
  if (!options.match && !options.ignore) return mw;
  const match = pathMatching(options);
  // 没有match的请求直接next()，match到的请求采用该中间件
  const fn = (ctx, next) => {
    if (!match(ctx)) return next();
    return mw(ctx, next);
  };
  fn._name = mw._name + 'middlewareWrapper';
  return fn;
}
