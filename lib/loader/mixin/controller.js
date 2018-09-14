'use strict';

const path = require('path');
const is = require('is-type-of');
const utility = require('utility');
const utils = require('../../utils');
const FULLPATH = require('../file_loader').FULLPATH;


module.exports = {

  /**
   * Load app/controller
   * @param {Object} opt - LoaderOptions
   * @since 1.0.0
   */
  loadController(opt) {
    this.timing.start('Load Controller');
    opt = Object.assign({
      caseStyle: 'lower',
      directory: path.join(this.options.baseDir, 'app/controller'),
      initializer: (obj, opt) => {
        // return class if it exports a function
        // ```js
        // module.exports = app => {
        //   return class HomeController extends app.Controller {};
        // }
        // ```
        if (is.function(obj) && !is.generatorFunction(obj) && !is.class(obj) && !is.asyncFunction(obj)) {
          obj = obj(this.app);
        }
        // 返回一个对象
        // ret = {}
        // ret[index] = function classControllerMiddleware(...args) {
        //       const controller = new Controller(this);
        //       if (!this.app.config.controller || !this.app.config.controller.supportParams) {
        //         args = [ this ];
        //       }
        //       return utils.callFn(controller[index], args, controller);
        //     };
        if (is.class(obj)) {
          obj.prototype.pathName = opt.pathName;
          obj.prototype.fullPath = opt.path;
          return wrapClass(obj);
        }
        if (is.object(obj)) {
          return wrapObject(obj, opt.path);
        }
        // support generatorFunction for forward compatbility
        if (is.generatorFunction(obj) || is.asyncFunction(obj)) {
          return wrapObject({ 'module.exports': obj }, opt.path)['module.exports'];
        }
        return obj;
      },
    }, opt);
    const controllerBase = opt.directory;

    this.loadToApp(controllerBase, 'controller', opt);
    this.options.logger.info('[egg:loader] Controller loaded: %s', controllerBase);
    this.timing.end('Load Controller');
  },

};

// wrap the class, yield a object with middlewares
// 返回一个对象
// ret = {}
// ret[index] = function classControllerMiddleware(...args) {
//       const controller = new Controller(this);
//       if (!this.app.config.controller || !this.app.config.controller.supportParams) {
//         args = [ this ];
//       }
//       return utils.callFn(controller[index], args, controller);
//     };
function wrapClass(Controller) {
  // controller的原型对象
  let proto = Controller.prototype;
  const ret = {};
  // tracing the prototype chain
  while (proto !== Object.prototype) {
    // Object.getOwnPropertyNames()方法返回一个由指定对象的所有自身属性的属性名（包括不可枚举属性但不包括Symbol值作为名称的属性）组成的数组。
    // 示例
    // var arr = ["a", "b", "c"];
    // console.log(Object.getOwnPropertyNames(arr).sort()); // ["0", "1", "2", "length"]

    // 类数组对象
    // var obj = { 0: "a", 1: "b", 2: "c"};
    // console.log(Object.getOwnPropertyNames(obj).sort()); // ["0", "1", "2"]

    // 使用Array.forEach输出属性名和属性值
    // Object.getOwnPropertyNames(obj).forEach(function(val, idx, array) {
    //     console.log(val + " -> " + obj[val]);
    // });
    // 输出
    // 0 -> a
    // 1 -> b
    // 2 -> c

    // 不可枚举属性
    // var my_obj = Object.create({}, {
    //     getFoo: {
    //         value: function() { return this.foo; },
    //         enumerable: false
    //     }
    // });
    // my_obj.foo = 1;
    //
    // console.log(Object.getOwnPropertyNames(my_obj).sort()); // ["foo", "getFoo"]
    const keys = Object.getOwnPropertyNames(proto); // 获取controller类中函数的名字
    for (const key of keys) {
      // getOwnPropertyNames will return constructor
      // that should be ignored
      if (key === 'constructor') {
        continue;
      }
      // skip getter, setter & non-function properties

      // Object.getOwnPropertyDescriptor() 方法返回指定对象上一个自有属性对应的属性描述符。（自有属性指的是直接赋予该对象的属性，不需要从原型链上进行查找的属性）
      // 示例
      //   var o, d;
      //
      //   o = { get foo() { return 17; } };
      //   d = Object.getOwnPropertyDescriptor(o, "foo");
      // d {
      //   configurable: true,
      //   enumerable: true,
      //   get: /*the getter function*/,
      //   set: undefined
      // }
      //
      // o = { bar: 42 };
      // d = Object.getOwnPropertyDescriptor(o, "bar");
      // d {
      //   configurable: true,
      //   enumerable: true,
      //   value: 42,
      //   writable: true
      // }
      //
      // o = {};
      // Object.defineProperty(o, "baz", {
      //     value: 8675309,
      //     writable: false,
      //     enumerable: false
      // });
      // d = Object.getOwnPropertyDescriptor(o, "baz");
      // d {
      //   value: 8675309,
      //   writable: false,
      //   enumerable: false,
      //   configurable: false
      // }
      //  * @type {PropertyDescriptor | undefined}
      //  */

      /**
         * 示例：
         * class newClass {
	     *      async index(){};
	     *      async second(){};
         * }
         *
         * Object.getOwnPropertyNames(newClass.prototype) // [ "constructior", "index", "second" ]
         * Object.getOwnPropertyDescriptor(newClass, 'prototype')
         * @type {PropertyDescriptor | undefined}
         */
      /**
         * // Object.getOwnPropertyDescriptor(newClass.prototype, 'index'): {value: ƒ, writable: true, enumerable: false, configurable: true}
         * value: ƒ async news()
         * @type {PropertyDescriptor | undefined}
         */
      const d = Object.getOwnPropertyDescriptor(proto, key);
      // prevent to override sub method
      // 确保只处理自身含有的属性（不包括继承来的）
      // key: [ "constructior", "index", "second" ]
      // 主要是为了传递this
      // ret[index] = function classControllerMiddleware(...args) {
      //       const controller = new Controller(this);
      //       if (!this.app.config.controller || !this.app.config.controller.supportParams) {
      //         args = [ this ];
      //       }
      //       return utils.callFn(controller[index], args, controller);
      //     };
      if (is.function(d.value) && !ret.hasOwnProperty(key)) {
        ret[key] = methodToMiddleware(Controller, key);
        ret[key][FULLPATH] = Controller.prototype.fullPath + '#' + Controller.name + '.' + key + '()';
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return ret;

  function methodToMiddleware(Controller, key) {
    return function classControllerMiddleware(...args) {
      const controller = new Controller(this);
      if (!this.app.config.controller || !this.app.config.controller.supportParams) {
        args = [ this ];
      }
      return utils.callFn(controller[key], args, controller);
    };
  }
}

// wrap the method of the object, method can receive ctx as it's first argument
function wrapObject(obj, path, prefix) {
  const keys = Object.keys(obj);
  const ret = {};
  for (const key of keys) {
    if (is.function(obj[key])) {
      const names = utility.getParamNames(obj[key]);
      if (names[0] === 'next') {
        throw new Error(`controller \`${prefix || ''}${key}\` should not use next as argument from file ${path}`);
      }
      ret[key] = functionToMiddleware(obj[key]);
      ret[key][FULLPATH] = `${path}#${prefix || ''}${key}()`;
    } else if (is.object(obj[key])) {
      ret[key] = wrapObject(obj[key], path, `${prefix || ''}${key}.`);
    }
  }
  return ret;

  function functionToMiddleware(func) {
    const objectControllerMiddleware = async function(...args) {
      if (!this.app.config.controller || !this.app.config.controller.supportParams) {
        args = [ this ];
      }
      return await utils.callFn(func, args, this);
    };
    for (const key in func) {
      objectControllerMiddleware[key] = func[key];
    }
    return objectControllerMiddleware;
  }
}
