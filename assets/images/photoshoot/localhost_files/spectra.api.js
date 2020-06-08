/*!
 * @overview es6-promise - a tiny implementation of Promises/A+.
 * @copyright Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors (Conversion to ES6 API by Jake Archibald)
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/stefanpenner/es6-promise/master/LICENSE
 * @version   4.1.0+f9a5575b
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global.ES6Promise = factory());
}(this, (function () { 'use strict';

function objectOrFunction(x) {
  return typeof x === 'function' || typeof x === 'object' && x !== null;
}

function isFunction(x) {
  return typeof x === 'function';
}

var _isArray = undefined;
if (!Array.isArray) {
  _isArray = function (x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  };
} else {
  _isArray = Array.isArray;
}

var isArray = _isArray;

var len = 0;
var vertxNext = undefined;
var customSchedulerFn = undefined;

var asap = function asap(callback, arg) {
  queue[len] = callback;
  queue[len + 1] = arg;
  len += 2;
  if (len === 2) {
    // If len is 2, that means that we need to schedule an async flush.
    // If additional callbacks are queued before the queue is flushed, they
    // will be processed by this flush that we are scheduling.
    if (customSchedulerFn) {
      customSchedulerFn(flush);
    } else {
      scheduleFlush();
    }
  }
};

function setScheduler(scheduleFn) {
  customSchedulerFn = scheduleFn;
}

function setAsap(asapFn) {
  asap = asapFn;
}

var browserWindow = typeof window !== 'undefined' ? window : undefined;
var browserGlobal = browserWindow || {};
var BrowserMutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
var isNode = typeof self === 'undefined' && typeof process !== 'undefined' && ({}).toString.call(process) === '[object process]';

// test for web worker but not in IE10
var isWorker = typeof Uint8ClampedArray !== 'undefined' && typeof importScripts !== 'undefined' && typeof MessageChannel !== 'undefined';

// node
function useNextTick() {
  // node version 0.10.x displays a deprecation warning when nextTick is used recursively
  // see https://github.com/cujojs/when/issues/410 for details
  return function () {
    return process.nextTick(flush);
  };
}

// vertx
function useVertxTimer() {
  if (typeof vertxNext !== 'undefined') {
    return function () {
      vertxNext(flush);
    };
  }

  return useSetTimeout();
}

function useMutationObserver() {
  var iterations = 0;
  var observer = new BrowserMutationObserver(flush);
  var node = document.createTextNode('');
  observer.observe(node, { characterData: true });

  return function () {
    node.data = iterations = ++iterations % 2;
  };
}

// web worker
function useMessageChannel() {
  var channel = new MessageChannel();
  channel.port1.onmessage = flush;
  return function () {
    return channel.port2.postMessage(0);
  };
}

function useSetTimeout() {
  // Store setTimeout reference so es6-promise will be unaffected by
  // other code modifying setTimeout (like sinon.useFakeTimers())
  var globalSetTimeout = setTimeout;
  return function () {
    return globalSetTimeout(flush, 1);
  };
}

var queue = new Array(1000);
function flush() {
  for (var i = 0; i < len; i += 2) {
    var callback = queue[i];
    var arg = queue[i + 1];

    callback(arg);

    queue[i] = undefined;
    queue[i + 1] = undefined;
  }

  len = 0;
}

function attemptVertx() {
  try {
    var r = require;
    var vertx = r('vertx');
    vertxNext = vertx.runOnLoop || vertx.runOnContext;
    return useVertxTimer();
  } catch (e) {
    return useSetTimeout();
  }
}

var scheduleFlush = undefined;
// Decide what async method to use to triggering processing of queued callbacks:
if (isNode) {
  scheduleFlush = useNextTick();
} else if (BrowserMutationObserver) {
  scheduleFlush = useMutationObserver();
} else if (isWorker) {
  scheduleFlush = useMessageChannel();
} else if (browserWindow === undefined && typeof require === 'function') {
  scheduleFlush = attemptVertx();
} else {
  scheduleFlush = useSetTimeout();
}

function then(onFulfillment, onRejection) {
  var _arguments = arguments;

  var parent = this;

  var child = new this.constructor(noop);

  if (child[PROMISE_ID] === undefined) {
    makePromise(child);
  }

  var _state = parent._state;

  if (_state) {
    (function () {
      var callback = _arguments[_state - 1];
      asap(function () {
        return invokeCallback(_state, child, callback, parent._result);
      });
    })();
  } else {
    subscribe(parent, child, onFulfillment, onRejection);
  }

  return child;
}

/**
  `Promise.resolve` returns a promise that will become resolved with the
  passed `value`. It is shorthand for the following:

  ```javascript
  let promise = new Promise(function(resolve, reject){
    resolve(1);
  });

  promise.then(function(value){
    // value === 1
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  let promise = Promise.resolve(1);

  promise.then(function(value){
    // value === 1
  });
  ```

  @method resolve
  @static
  @param {Any} value value that the returned promise will be resolved with
  Useful for tooling.
  @return {Promise} a promise that will become fulfilled with the given
  `value`
*/
function resolve(object) {
  /*jshint validthis:true */
  var Constructor = this;

  if (object && typeof object === 'object' && object.constructor === Constructor) {
    return object;
  }

  var promise = new Constructor(noop);
  _resolve(promise, object);
  return promise;
}

var PROMISE_ID = Math.random().toString(36).substring(16);

function noop() {}

var PENDING = void 0;
var FULFILLED = 1;
var REJECTED = 2;

var GET_THEN_ERROR = new ErrorObject();

function selfFulfillment() {
  return new TypeError("You cannot resolve a promise with itself");
}

function cannotReturnOwn() {
  return new TypeError('A promises callback cannot return that same promise.');
}

function getThen(promise) {
  try {
    return promise.then;
  } catch (error) {
    GET_THEN_ERROR.error = error;
    return GET_THEN_ERROR;
  }
}

function tryThen(then, value, fulfillmentHandler, rejectionHandler) {
  try {
    then.call(value, fulfillmentHandler, rejectionHandler);
  } catch (e) {
    return e;
  }
}

function handleForeignThenable(promise, thenable, then) {
  asap(function (promise) {
    var sealed = false;
    var error = tryThen(then, thenable, function (value) {
      if (sealed) {
        return;
      }
      sealed = true;
      if (thenable !== value) {
        _resolve(promise, value);
      } else {
        fulfill(promise, value);
      }
    }, function (reason) {
      if (sealed) {
        return;
      }
      sealed = true;

      _reject(promise, reason);
    }, 'Settle: ' + (promise._label || ' unknown promise'));

    if (!sealed && error) {
      sealed = true;
      _reject(promise, error);
    }
  }, promise);
}

function handleOwnThenable(promise, thenable) {
  if (thenable._state === FULFILLED) {
    fulfill(promise, thenable._result);
  } else if (thenable._state === REJECTED) {
    _reject(promise, thenable._result);
  } else {
    subscribe(thenable, undefined, function (value) {
      return _resolve(promise, value);
    }, function (reason) {
      return _reject(promise, reason);
    });
  }
}

function handleMaybeThenable(promise, maybeThenable, then$$) {
  if (maybeThenable.constructor === promise.constructor && then$$ === then && maybeThenable.constructor.resolve === resolve) {
    handleOwnThenable(promise, maybeThenable);
  } else {
    if (then$$ === GET_THEN_ERROR) {
      _reject(promise, GET_THEN_ERROR.error);
      GET_THEN_ERROR.error = null;
    } else if (then$$ === undefined) {
      fulfill(promise, maybeThenable);
    } else if (isFunction(then$$)) {
      handleForeignThenable(promise, maybeThenable, then$$);
    } else {
      fulfill(promise, maybeThenable);
    }
  }
}

function _resolve(promise, value) {
  if (promise === value) {
    _reject(promise, selfFulfillment());
  } else if (objectOrFunction(value)) {
    handleMaybeThenable(promise, value, getThen(value));
  } else {
    fulfill(promise, value);
  }
}

function publishRejection(promise) {
  if (promise._onerror) {
    promise._onerror(promise._result);
  }

  publish(promise);
}

function fulfill(promise, value) {
  if (promise._state !== PENDING) {
    return;
  }

  promise._result = value;
  promise._state = FULFILLED;

  if (promise._subscribers.length !== 0) {
    asap(publish, promise);
  }
}

function _reject(promise, reason) {
  if (promise._state !== PENDING) {
    return;
  }
  promise._state = REJECTED;
  promise._result = reason;

  asap(publishRejection, promise);
}

function subscribe(parent, child, onFulfillment, onRejection) {
  var _subscribers = parent._subscribers;
  var length = _subscribers.length;

  parent._onerror = null;

  _subscribers[length] = child;
  _subscribers[length + FULFILLED] = onFulfillment;
  _subscribers[length + REJECTED] = onRejection;

  if (length === 0 && parent._state) {
    asap(publish, parent);
  }
}

function publish(promise) {
  var subscribers = promise._subscribers;
  var settled = promise._state;

  if (subscribers.length === 0) {
    return;
  }

  var child = undefined,
      callback = undefined,
      detail = promise._result;

  for (var i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    if (child) {
      invokeCallback(settled, child, callback, detail);
    } else {
      callback(detail);
    }
  }

  promise._subscribers.length = 0;
}

function ErrorObject() {
  this.error = null;
}

var TRY_CATCH_ERROR = new ErrorObject();

function tryCatch(callback, detail) {
  try {
    return callback(detail);
  } catch (e) {
    TRY_CATCH_ERROR.error = e;
    return TRY_CATCH_ERROR;
  }
}

function invokeCallback(settled, promise, callback, detail) {
  var hasCallback = isFunction(callback),
      value = undefined,
      error = undefined,
      succeeded = undefined,
      failed = undefined;

  if (hasCallback) {
    value = tryCatch(callback, detail);

    if (value === TRY_CATCH_ERROR) {
      failed = true;
      error = value.error;
      value.error = null;
    } else {
      succeeded = true;
    }

    if (promise === value) {
      _reject(promise, cannotReturnOwn());
      return;
    }
  } else {
    value = detail;
    succeeded = true;
  }

  if (promise._state !== PENDING) {
    // noop
  } else if (hasCallback && succeeded) {
      _resolve(promise, value);
    } else if (failed) {
      _reject(promise, error);
    } else if (settled === FULFILLED) {
      fulfill(promise, value);
    } else if (settled === REJECTED) {
      _reject(promise, value);
    }
}

function initializePromise(promise, resolver) {
  try {
    resolver(function resolvePromise(value) {
      _resolve(promise, value);
    }, function rejectPromise(reason) {
      _reject(promise, reason);
    });
  } catch (e) {
    _reject(promise, e);
  }
}

var id = 0;
function nextId() {
  return id++;
}

function makePromise(promise) {
  promise[PROMISE_ID] = id++;
  promise._state = undefined;
  promise._result = undefined;
  promise._subscribers = [];
}

function Enumerator(Constructor, input) {
  this._instanceConstructor = Constructor;
  this.promise = new Constructor(noop);

  if (!this.promise[PROMISE_ID]) {
    makePromise(this.promise);
  }

  if (isArray(input)) {
    this._input = input;
    this.length = input.length;
    this._remaining = input.length;

    this._result = new Array(this.length);

    if (this.length === 0) {
      fulfill(this.promise, this._result);
    } else {
      this.length = this.length || 0;
      this._enumerate();
      if (this._remaining === 0) {
        fulfill(this.promise, this._result);
      }
    }
  } else {
    _reject(this.promise, validationError());
  }
}

function validationError() {
  return new Error('Array Methods must be provided an Array');
};

Enumerator.prototype._enumerate = function () {
  var length = this.length;
  var _input = this._input;

  for (var i = 0; this._state === PENDING && i < length; i++) {
    this._eachEntry(_input[i], i);
  }
};

Enumerator.prototype._eachEntry = function (entry, i) {
  var c = this._instanceConstructor;
  var resolve$$ = c.resolve;

  if (resolve$$ === resolve) {
    var _then = getThen(entry);

    if (_then === then && entry._state !== PENDING) {
      this._settledAt(entry._state, i, entry._result);
    } else if (typeof _then !== 'function') {
      this._remaining--;
      this._result[i] = entry;
    } else if (c === Promise) {
      var promise = new c(noop);
      handleMaybeThenable(promise, entry, _then);
      this._willSettleAt(promise, i);
    } else {
      this._willSettleAt(new c(function (resolve$$) {
        return resolve$$(entry);
      }), i);
    }
  } else {
    this._willSettleAt(resolve$$(entry), i);
  }
};

Enumerator.prototype._settledAt = function (state, i, value) {
  var promise = this.promise;

  if (promise._state === PENDING) {
    this._remaining--;

    if (state === REJECTED) {
      _reject(promise, value);
    } else {
      this._result[i] = value;
    }
  }

  if (this._remaining === 0) {
    fulfill(promise, this._result);
  }
};

Enumerator.prototype._willSettleAt = function (promise, i) {
  var enumerator = this;

  subscribe(promise, undefined, function (value) {
    return enumerator._settledAt(FULFILLED, i, value);
  }, function (reason) {
    return enumerator._settledAt(REJECTED, i, reason);
  });
};

/**
  `Promise.all` accepts an array of promises, and returns a new promise which
  is fulfilled with an array of fulfillment values for the passed promises, or
  rejected with the reason of the first passed promise to be rejected. It casts all
  elements of the passed iterable to promises as it runs this algorithm.

  Example:

  ```javascript
  let promise1 = resolve(1);
  let promise2 = resolve(2);
  let promise3 = resolve(3);
  let promises = [ promise1, promise2, promise3 ];

  Promise.all(promises).then(function(array){
    // The array here would be [ 1, 2, 3 ];
  });
  ```

  If any of the `promises` given to `all` are rejected, the first promise
  that is rejected will be given as an argument to the returned promises's
  rejection handler. For example:

  Example:

  ```javascript
  let promise1 = resolve(1);
  let promise2 = reject(new Error("2"));
  let promise3 = reject(new Error("3"));
  let promises = [ promise1, promise2, promise3 ];

  Promise.all(promises).then(function(array){
    // Code here never runs because there are rejected promises!
  }, function(error) {
    // error.message === "2"
  });
  ```

  @method all
  @static
  @param {Array} entries array of promises
  @param {String} label optional string for labeling the promise.
  Useful for tooling.
  @return {Promise} promise that is fulfilled when all `promises` have been
  fulfilled, or rejected if any of them become rejected.
  @static
*/
function all(entries) {
  return new Enumerator(this, entries).promise;
}

/**
  `Promise.race` returns a new promise which is settled in the same way as the
  first passed promise to settle.

  Example:

  ```javascript
  let promise1 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 1');
    }, 200);
  });

  let promise2 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 2');
    }, 100);
  });

  Promise.race([promise1, promise2]).then(function(result){
    // result === 'promise 2' because it was resolved before promise1
    // was resolved.
  });
  ```

  `Promise.race` is deterministic in that only the state of the first
  settled promise matters. For example, even if other promises given to the
  `promises` array argument are resolved, but the first settled promise has
  become rejected before the other promises became fulfilled, the returned
  promise will become rejected:

  ```javascript
  let promise1 = new Promise(function(resolve, reject){
    setTimeout(function(){
      resolve('promise 1');
    }, 200);
  });

  let promise2 = new Promise(function(resolve, reject){
    setTimeout(function(){
      reject(new Error('promise 2'));
    }, 100);
  });

  Promise.race([promise1, promise2]).then(function(result){
    // Code here never runs
  }, function(reason){
    // reason.message === 'promise 2' because promise 2 became rejected before
    // promise 1 became fulfilled
  });
  ```

  An example real-world use case is implementing timeouts:

  ```javascript
  Promise.race([ajax('foo.json'), timeout(5000)])
  ```

  @method race
  @static
  @param {Array} promises array of promises to observe
  Useful for tooling.
  @return {Promise} a promise which settles in the same way as the first passed
  promise to settle.
*/
function race(entries) {
  /*jshint validthis:true */
  var Constructor = this;

  if (!isArray(entries)) {
    return new Constructor(function (_, reject) {
      return reject(new TypeError('You must pass an array to race.'));
    });
  } else {
    return new Constructor(function (resolve, reject) {
      var length = entries.length;
      for (var i = 0; i < length; i++) {
        Constructor.resolve(entries[i]).then(resolve, reject);
      }
    });
  }
}

/**
  `Promise.reject` returns a promise rejected with the passed `reason`.
  It is shorthand for the following:

  ```javascript
  let promise = new Promise(function(resolve, reject){
    reject(new Error('WHOOPS'));
  });

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  let promise = Promise.reject(new Error('WHOOPS'));

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  @method reject
  @static
  @param {Any} reason value that the returned promise will be rejected with.
  Useful for tooling.
  @return {Promise} a promise rejected with the given `reason`.
*/
function reject(reason) {
  /*jshint validthis:true */
  var Constructor = this;
  var promise = new Constructor(noop);
  _reject(promise, reason);
  return promise;
}

function needsResolver() {
  throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
}

function needsNew() {
  throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
}

/**
  Promise objects represent the eventual result of an asynchronous operation. The
  primary way of interacting with a promise is through its `then` method, which
  registers callbacks to receive either a promise's eventual value or the reason
  why the promise cannot be fulfilled.

  Terminology
  -----------

  - `promise` is an object or function with a `then` method whose behavior conforms to this specification.
  - `thenable` is an object or function that defines a `then` method.
  - `value` is any legal JavaScript value (including undefined, a thenable, or a promise).
  - `exception` is a value that is thrown using the throw statement.
  - `reason` is a value that indicates why a promise was rejected.
  - `settled` the final resting state of a promise, fulfilled or rejected.

  A promise can be in one of three states: pending, fulfilled, or rejected.

  Promises that are fulfilled have a fulfillment value and are in the fulfilled
  state.  Promises that are rejected have a rejection reason and are in the
  rejected state.  A fulfillment value is never a thenable.

  Promises can also be said to *resolve* a value.  If this value is also a
  promise, then the original promise's settled state will match the value's
  settled state.  So a promise that *resolves* a promise that rejects will
  itself reject, and a promise that *resolves* a promise that fulfills will
  itself fulfill.


  Basic Usage:
  ------------

  ```js
  let promise = new Promise(function(resolve, reject) {
    // on success
    resolve(value);

    // on failure
    reject(reason);
  });

  promise.then(function(value) {
    // on fulfillment
  }, function(reason) {
    // on rejection
  });
  ```

  Advanced Usage:
  ---------------

  Promises shine when abstracting away asynchronous interactions such as
  `XMLHttpRequest`s.

  ```js
  function getJSON(url) {
    return new Promise(function(resolve, reject){
      let xhr = new XMLHttpRequest();

      xhr.open('GET', url);
      xhr.onreadystatechange = handler;
      xhr.responseType = 'json';
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send();

      function handler() {
        if (this.readyState === this.DONE) {
          if (this.status === 200) {
            resolve(this.response);
          } else {
            reject(new Error('getJSON: `' + url + '` failed with status: [' + this.status + ']'));
          }
        }
      };
    });
  }

  getJSON('/posts.json').then(function(json) {
    // on fulfillment
  }, function(reason) {
    // on rejection
  });
  ```

  Unlike callbacks, promises are great composable primitives.

  ```js
  Promise.all([
    getJSON('/posts'),
    getJSON('/comments')
  ]).then(function(values){
    values[0] // => postsJSON
    values[1] // => commentsJSON

    return values;
  });
  ```

  @class Promise
  @param {function} resolver
  Useful for tooling.
  @constructor
*/
function Promise(resolver) {
  this[PROMISE_ID] = nextId();
  this._result = this._state = undefined;
  this._subscribers = [];

  if (noop !== resolver) {
    typeof resolver !== 'function' && needsResolver();
    this instanceof Promise ? initializePromise(this, resolver) : needsNew();
  }
}

Promise.all = all;
Promise.race = race;
Promise.resolve = resolve;
Promise.reject = reject;
Promise._setScheduler = setScheduler;
Promise._setAsap = setAsap;
Promise._asap = asap;

Promise.prototype = {
  constructor: Promise,

  /**
    The primary way of interacting with a promise is through its `then` method,
    which registers callbacks to receive either a promise's eventual value or the
    reason why the promise cannot be fulfilled.

    ```js
    findUser().then(function(user){
      // user is available
    }, function(reason){
      // user is unavailable, and you are given the reason why
    });
    ```

    Chaining
    --------

    The return value of `then` is itself a promise.  This second, 'downstream'
    promise is resolved with the return value of the first promise's fulfillment
    or rejection handler, or rejected if the handler throws an exception.

    ```js
    findUser().then(function (user) {
      return user.name;
    }, function (reason) {
      return 'default name';
    }).then(function (userName) {
      // If `findUser` fulfilled, `userName` will be the user's name, otherwise it
      // will be `'default name'`
    });

    findUser().then(function (user) {
      throw new Error('Found user, but still unhappy');
    }, function (reason) {
      throw new Error('`findUser` rejected and we're unhappy');
    }).then(function (value) {
      // never reached
    }, function (reason) {
      // if `findUser` fulfilled, `reason` will be 'Found user, but still unhappy'.
      // If `findUser` rejected, `reason` will be '`findUser` rejected and we're unhappy'.
    });
    ```
    If the downstream promise does not specify a rejection handler, rejection reasons will be propagated further downstream.

    ```js
    findUser().then(function (user) {
      throw new PedagogicalException('Upstream error');
    }).then(function (value) {
      // never reached
    }).then(function (value) {
      // never reached
    }, function (reason) {
      // The `PedgagocialException` is propagated all the way down to here
    });
    ```

    Assimilation
    ------------

    Sometimes the value you want to propagate to a downstream promise can only be
    retrieved asynchronously. This can be achieved by returning a promise in the
    fulfillment or rejection handler. The downstream promise will then be pending
    until the returned promise is settled. This is called *assimilation*.

    ```js
    findUser().then(function (user) {
      return findCommentsByAuthor(user);
    }).then(function (comments) {
      // The user's comments are now available
    });
    ```

    If the assimliated promise rejects, then the downstream promise will also reject.

    ```js
    findUser().then(function (user) {
      return findCommentsByAuthor(user);
    }).then(function (comments) {
      // If `findCommentsByAuthor` fulfills, we'll have the value here
    }, function (reason) {
      // If `findCommentsByAuthor` rejects, we'll have the reason here
    });
    ```

    Simple Example
    --------------

    Synchronous Example

    ```javascript
    let result;

    try {
      result = findResult();
      // success
    } catch(reason) {
      // failure
    }
    ```

    Errback Example

    ```js
    findResult(function(result, err){
      if (err) {
        // failure
      } else {
        // success
      }
    });
    ```

    Promise Example;

    ```javascript
    findResult().then(function(result){
      // success
    }, function(reason){
      // failure
    });
    ```

    Advanced Example
    --------------

    Synchronous Example

    ```javascript
    let author, books;

    try {
      author = findAuthor();
      books  = findBooksByAuthor(author);
      // success
    } catch(reason) {
      // failure
    }
    ```

    Errback Example

    ```js

    function foundBooks(books) {

    }

    function failure(reason) {

    }

    findAuthor(function(author, err){
      if (err) {
        failure(err);
        // failure
      } else {
        try {
          findBoooksByAuthor(author, function(books, err) {
            if (err) {
              failure(err);
            } else {
              try {
                foundBooks(books);
              } catch(reason) {
                failure(reason);
              }
            }
          });
        } catch(error) {
          failure(err);
        }
        // success
      }
    });
    ```

    Promise Example;

    ```javascript
    findAuthor().
      then(findBooksByAuthor).
      then(function(books){
        // found books
    }).catch(function(reason){
      // something went wrong
    });
    ```

    @method then
    @param {Function} onFulfilled
    @param {Function} onRejected
    Useful for tooling.
    @return {Promise}
  */
  then: then,

  /**
    `catch` is simply sugar for `then(undefined, onRejection)` which makes it the same
    as the catch block of a try/catch statement.

    ```js
    function findAuthor(){
      throw new Error('couldn't find that author');
    }

    // synchronous
    try {
      findAuthor();
    } catch(reason) {
      // something went wrong
    }

    // async with promises
    findAuthor().catch(function(reason){
      // something went wrong
    });
    ```

    @method catch
    @param {Function} onRejection
    Useful for tooling.
    @return {Promise}
  */
  'catch': function _catch(onRejection) {
    return this.then(null, onRejection);
  }
};

function polyfill() {
    var local = undefined;

    if (typeof global !== 'undefined') {
        local = global;
    } else if (typeof self !== 'undefined') {
        local = self;
    } else {
        try {
            local = Function('return this')();
        } catch (e) {
            throw new Error('polyfill failed because global object is unavailable in this environment');
        }
    }

    var P = local.Promise;

    if (P) {
        var promiseToString = null;
        try {
            promiseToString = Object.prototype.toString.call(P.resolve());
        } catch (e) {
            // silently ignored
        }

        if (promiseToString === '[object Promise]' && !P.cast) {
            return;
        }
    }

    local.Promise = Promise;
}

// Strange compat..
Promise.polyfill = polyfill;
Promise.Promise = Promise;

return Promise;

})));

(function(context) {
  if (context.libutils) {
    return;
  }
  var
    SUPPORT_IE = true,
    ObjectDefineProperty = Object.defineProperty,
    locationSearch;
  try {
    locationSearch= context.location.search;
  } catch(e) {
    locationSearch = '';
  }

  /////////////////////////////////////////////////
  //
  // BEGIN performance.now polyfill
  // based on source: https://gist.github.com/paulirish/5438650 (Except IE8)
  //
  var
    STR_PERFORMANCE = 'performance',
    performance = context[STR_PERFORMANCE] = (context[STR_PERFORMANCE] || {});

  if (!performance.now){
    var
      performanceTiming = performance.timing,
      navigationStart = performanceTiming? performanceTiming.navigationStart: Date.now();

    performance.now = function now(){
      return Date.now() - navigationStart;
    };
  }
  // END performance.now polyfill
  //
  /////////////////////////////////////////////////

/**
 * http://en.wikipedia.org/wiki/Universally_unique_identifier#Version_4_.28random.29
**/
  function makeEnumerableDef(value) {
    return {
        enumerable: true,
        value: value
      };
  }

  var searchParams = (function() {
    var query = {},
        a = locationSearch.substring(1).split('&'), pair, d = decodeURIComponent;
    for (var i = a.length - 1; i >= 0; i--) {
      pair = a[i].split('=');
      query[d(pair[0])] = d(pair[1] || '');
    }
    return RO({}, query);
  })();

  function getUUIDv4() {
    var uuid = "", i, random;
    for (i = 0; i < 32; i++) {
      random = Math.random() * 16 | 0;

      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += "-";
      }
      uuid += (i === 12 ? 4 : (i === 16 ? (random & 3 | 8) : random)).toString(16);
    }
    return uuid;
  }

  function copy(src) {
    return JSON.parse(JSON.stringify(src));
  }
  // TODO: at build time, import this from
  // external module (74b)
  function RO(who, values) {
    for (var k in values) {
      ObjectDefineProperty(who, k, makeEnumerableDef(values[k]));
    }
    return who;
  }
  function pass(arg) {
    return arg;
  }

  function noop() {
  }

  function call() {
    var
      args = Array.prototype.slice.call(arguments),
      who = args.shift(),
      what = args.shift();
    return isFunction(who[what])? who[what].apply(who, args): null;
  }

  function isInstanceof(obj, type) {
    return obj instanceof type;
  }

  function getType(obj) {
    return typeof obj;
  }
  function isType(obj, type) {
    return getType(obj) === type;
  }

  function isFunction(item) {
    return isType(item, 'function');
  }
  // is object a string
  function isString(obj) {
    return isType(obj, 'string');
  }

  function doDelete(who, what) {
    delete who[what];
  }

  function isWildCard(value) {
    return (value.indexOf('*') !== -1) || (value.indexOf('?') !== -1);
  }
  function wildCardToRegex(string){
    string = string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"); // escape string http://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
    string = string.replace(/\\\*/g, '.*');
    string = string.replace(/\\\?/g, '.');
    return '^' + string + '$';
  }

  function defaultValue(value, def) {
    return (value==null)? def: value;
  }
  function OverrideMethod(obj, name, method, ro) {
    if (!isFunction(obj[name]) && isFunction(method)) {
      if (ro) {
        var def = makeEnumerableDef(method);
        RO(obj, def);
      } else {
        obj[name] = method;
      }
    }
  }
  function OverrideMethods(obj, hash, ro) {
    for (var k in hash) {
      OverrideMethod(obj, k, hash[k], ro);
    }
  }

  OverrideMethods(String.prototype, {
    startsWith: function(str) {
      return this.slice(0, str.length) === str;
    },
    endsWith: function(str) {
      return this.slice(-str.length) === str;
    }
  });

  function throwNULL(why) {
    throw new TypeError('null '+ why);
  }

  function unique(array) {
    return array.filter(function(v,i,src) {
      return src.indexOf(v) === i;
    });
  }

  function Proxy(context, closureOrName, warn) {
    return function() {
      var closure = isString(closureOrName)? context[closureOrName]: closureOrName;
      if (closure) {
        return closure.apply(context, arguments);
      } else if (warn) {
        console.warn('No closure', closureOrName);
      }
    };
  }
  function ProxifyMember(obj, impl, name, ro) {
    var def = {
      enumerable: true,
      get: function() {
        return impl[name];
      }
    };
    if (ro) {
      def.set = function(value) {
        var result = (impl[name] = value);
        return result;
      };
    }

    ObjectDefineProperty(obj, name, def);
  }

  function doProxify(obj, impl, names, ro) {
    names.forEach(function(name) {
      var value = impl[name];
      if (isFunction(value)) {
        var proxy = Proxy(impl, value);
        if (ro) {
          ObjectDefineProperty(obj, name, makeEnumerableDef(proxy));
        } else {
          obj[name] = proxy;
        }
      } else {
        ProxifyMember(obj, impl, name, ro);
      }
    });
  }
  function Proxify(obj, impl, names, roNames) {
    doProxify(obj, impl, names || []);
    doProxify(obj, impl, roNames||[], true);
    return obj;
  }

  var ES6PromisePolyFill = (context.ES6Promise||{}).polyfill;
  if (isFunction(ES6PromisePolyFill)) {
    ES6PromisePolyFill();
  }
  var PromiseType, Deferred;
  // Extend the native Promise object
  PromiseType = window.Promise;
  Deferred = function() {
    if (!(isInstanceof(this, Deferred))) {
      return new Deferred();
    }
    var
      resolve,
      reject,
      state = 'pending',
      promise = new PromiseType(function(resolveCB, rejectCB) {
        resolve = function() {
          state = 'resolved';
          resolveCB.apply(this, arguments);
        };
        reject = function() {
          state = 'rejected';
          rejectCB.apply(this, arguments);
        };
      });
    function getPromise() {
      return promise;
    }
    function getState() {
      return state;
    }

    return RO({}, {
      state:    getState,
      resolve:  resolve,
      reject:   reject,
      promise:  getPromise,
      then:     Proxy(promise, promise.then),
      catch:    Proxy(promise, promise.catch),
      finally:  Proxy(promise, promise.finally),
      fail:     Proxy(promise, promise.fail),
//        always:   Proxy(promise, promise.always),
//        done:     Proxy(promise, promise.done),
    });
  };
  var extensions = {
    hash: function(object) {
      if (!isInstanceof(object, Object)) {
        throw new Error('only objects');
      }
      var
        names = Object.keys(object),
        asArray = names.map(function(v) {
          return object[v];
        }),
        meta = Promise.all(asArray).then(function(results) {
          return names.reduce(function(tgt, key, i) {
            tgt[key] = results[i];
            return tgt;
          }, {});
        });
      return meta;
      // Typeof object
    },
    Deferred: Deferred,
    rethrow: function(e) {
      throw e;
    },
    resolve: function() {
      console.error('not implemented');
    }
  }, protoExtensions = {
    finally: function(onResolveOrReject) {
      return this.catch(function(reason){
        return reason;
      }).then(onResolveOrReject);
    },
    always: function(onResolveOrReject) {
      return this.then(onResolveOrReject,
        function(reason) {
          onResolveOrReject(reason);
          throw reason;
        });
    },
//      done: function(onDone) {
//        return this.then(function(result) {
//          onDone(result);
//          return result;
//        });
//      }
  };
  // Transitional jQuery polyfill
  var map = {
    fail: 'catch',
  }, PromiseProto = PromiseType.prototype;
  for (var k in map) {
    PromiseProto[k] = PromiseProto[map[k]];
  }

  if (false) {
    PromiseProto.done = function(closure) {
      return this.then(function(result) {
        try {
          closure.call(RO({}, result));
        } catch(e) {
        }
        return result;
      });
    };
  }
  OverrideMethods(PromiseProto, protoExtensions);
  OverrideMethods(PromiseType, extensions);

  function not(closure, context) {
    return function() {
      return !closure.apply(context, arguments);
    };
  }
  function PromiseOnce(ctor) {
    var task;
    return function() {
      if (!task) {
        task = Promisify(ctor()).fail(function(e) {
          PromiseType.rethrow(e);
          task = null;
        });
      }
      return task;
    };
  }

  function Promisify(result) {
    // thenable
    return new PromiseType(function(resolve, reject) {
      if (isInstanceof(result, PromiseType)) {
        result.then(resolve).catch(reject);
      } else if (result && isFunction(result.then)) {
        if (isFunction(result.fail)) {
          result.then(resolve).fail(reject);
        } else {
          result.then(resolve);
        }
      } else if (Array.isArray(result)) {
        Promise.all(result).then(resove).fail(reject);
      } else {
        resolve(result);
      }
    });
  }

  function extractSearchParam(parameterName, defaultValue, optsource) {
    var result = (parameterName === null)? null: (optsource?
      ((new RegExp('[\?&]'+ parameterName +'=([^&+]*)', 'i').exec(optsource) || [0,defaultValue])[1]):
      searchParams[parameterName] == null? null: searchParams[parameterName]);
    return (result === null)? defaultValue: (''+result);
  }

  // Taken from jquery.min.js
  function isPlainObject(obj) {
    if (!isType(obj, 'object') || obj.nodeType || (obj && obj === obj.window)) {
      return false;
    }
    try {
      if (obj.constructor && !hasOwnProperty.call(obj.constructor.prototype, "isPrototypeOf")) {
        return false;
      }
    } catch(e) {
      return false;
    }
    return true;
  }

  // modified from https://github.com/grncdr/js-capitalize/blob/master/index.js
  function capitalize(string) {
    return !string? string:
      string.charAt(0).toUpperCase() + string.substring(1);
  }
  capitalize.words = function(string) {
    return !string? string:
      string.replace(/(^|[^a-zA-Z\u00C0-\u017F'])([a-zA-Z\u00C0-\u017F])/g, function (m) {
        return m.toUpperCase();
      });
  };

/////////////////////////////////////////////////
//// BEGIN DOCUMENT READY
//// This reproduces behaviour of $.ready.
  var
    ready = new PromiseType.Deferred(),
    readyProxy = Proxy(ready, ready.resolve),
    docu = document,
    STR_AEL='addEventListener',
    STR_IEEV='attachEvent',
    attempts = [
      [Proxy(docu, STR_AEL),    'DOMContentLoaded', false],
      [Proxy(context, STR_AEL), 'load', false],
    ].concat(SUPPORT_IE?[
      [Proxy(docu, STR_IEEV),   'onreadystatechange'],
      [Proxy(context, STR_IEEV),'onload'],
    ]:[]);

  while(attempts.length) {
    var bind = attempts.shift();
    try {
      bind[0](bind[1],readyProxy,bind[2]);
      // We could empty the list here but the promise will resolve only once
      // Technically this is a leak because we are never unbinding the event listener.
      // However this is acceptable considering it binds only once
    } catch(e){}
  }
//// END DOCUMENT READY
/////////////////////////////////////////////////
  RO(context, {
    libutils: RO({}, {
      RO: RO,
      copy: copy,
      proxy: Proxy,
      Proxify: Proxify,
      UUIDv4: getUUIDv4,
      ODP: ObjectDefineProperty,
      ODPs: Object.defineProperties,
      ORMs: OverrideMethods,
      del: doDelete,
      isStr: isString,
      isPlainObject: isPlainObject,
      isF:  isFunction,
      ist:  isType,
      isa:  isInstanceof,
      tof:  getType,
      noop: noop,
      not:  not,
      pass: pass,
      unique: unique,
      call: call,
      iswc: isWildCard,
      wctoregex: wildCardToRegex,
      throwNULL: throwNULL,
      Promise: PromiseType,
      defv: defaultValue,
      ready: ready.promise(),
      PromiseOnce: PromiseOnce,
      when: Promisify,
      searchParams: searchParams,
      getSearchParam: extractSearchParam,
      capitalize: capitalize,
    })
  });
})(this);

(function(window) {
  if (window.liblog) {
    return;
  }
  var
    libutils = window.libutils,
    isString = libutils.isStr,
    isA = libutils.isa,
    ODPs = libutils.ODPs,
    isFunction = libutils.isF,
    isWildCard = libutils.iswc,
    isntWildCard = libutils.not(isWildCard),
    wildCardToRegex = libutils.wctoregex,
    RO = libutils.RO,
    unique = libutils.unique,
    Arr = Array,
    STR_PROTOTYPE = 'prototype',
    STR_REMOTE = 'remote',
    STR_CONSOLE = 'console',
    STR_LIBLOG = 'liblog',
    STR_TABLE = 'table',
    STR_DOT_LIBLOG = '.' + STR_LIBLOG,
    ArrProto = Arr[STR_PROTOTYPE],
    ArrProtoSlice = ArrProto.slice,
    browserConsole = window[STR_CONSOLE],
    singleton,
    ObjectKeys = Object.keys,
    warn_error_sinks = [STR_REMOTE];

  var
    LVL_IGNORE = 200000,
    LVL_ERROR = 6,
    LVL_WARN  = 5,
    LVL_INFO  = 4,
    LVL_LOG   = 3,
    LVL_DEBUG = 2,
    LVL_TRACE = 1,
    NUM_LEVELS = [LVL_TRACE, LVL_DEBUG, LVL_LOG, LVL_INFO, LVL_WARN, LVL_ERROR],
    LVLS_SHORT = RO({}, {
      E: LVL_ERROR,
      W: LVL_WARN,
      I: LVL_INFO,
      L: LVL_LOG,
      D: LVL_DEBUG,
      T: LVL_TRACE,
      O: LVL_IGNORE,
    });

  // Log levels
  var
    STR_ERROR = 'error',
    STR_WARN  = 'warn',
    STR_INFO  = 'info',
    STR_LOG   = 'log',
    STR_DEBUG = 'debug',
    STR_TRACE = 'trace',
    // list of log levels.
    LEVELS = [ null, STR_TRACE, STR_DEBUG, STR_LOG, STR_INFO, STR_WARN, STR_ERROR ];

  var
    sinkMinLevel = {},
    channelMinLevel = {}, // k: channelName, v: minLevel,
    resolvedChannelSinks = {},
    resolvedChannelLevels = {}, // k: channelName, v: {level: null/1}
    resolvedSinkChannels = {}, // k:
    excludedChannelSinks = {}, // k: channel, v: sink
    pipeRules = {},
    sinkInstances = {}, // k: type, v: array of Sinks
    mutedSinks = {},
    mutedChannels = {},
    dirty = 1,
    metrics = {
      obs: 0,
      test: 0,
      channels: {},
      total: 0,
      sinks: {},
      levels: {},
      calls: 0,
      piped: 0
    };

  function performanceNow() {
    return performance.now();
  }

  function updateLogMetric(channel, level, duration) {
    var
      start = performanceNow(),
      levelStr = LEVELS[level],
      channels = metrics.channels,
      channelMetric = channels[channel] = (channels[channel]||{total:0});

    metrics.total += duration;
    metrics.levels[levelStr] = (metrics.levels[levelStr]||0) + duration;
    channelMetric.total += duration;
    channelMetric[levelStr] = (channelMetric[levelStr] ||0) + duration;
    metrics.obs += performanceNow() - start;
  }

  function reduceMinSinkLevel(tgt, sink) {
    return Math.min(tgt, sinkMinLevel[sink]);
  }

  function buildList(list, regex) {
    return unique(list.filter(function(name) {
      return name.match(regex);
    }));
  }

  function applyPipeRules() {
    var
      sinkNames = ObjectKeys(sinkMinLevel),
      sinkChannels = {};

      function reduceSinks(tgt, regex) {
        return tgt.concat(buildList(sinkNames, regex));
      }

    ObjectKeys(pipeRules).forEach(function(channelRule) {
      var
        sinkRules = pipeRules[channelRule],
        chG = wildCardToRegex(channelRule),
        snGs = sinkRules.map(wildCardToRegex),
        allChannels = unique(buildList(ObjectKeys(channelMinLevel), chG)),
        allSinks    = snGs.reduce(reduceSinks,[]);

      allSinks.reduce(function(tgt, sinkName) {
        var list = tgt[sinkName]||[];
        list = unique(list.concat(allChannels.filter(function(channel) {
          return (excludedChannelSinks[channel]||[]).indexOf(sinkName) === -1;
        })));
        tgt[sinkName] = list;
        return tgt;
      }, sinkChannels);
    });

    resolvedSinkChannels = sinkChannels;
    resolvedChannelSinks = {};
    ObjectKeys(sinkChannels).forEach(function(sinkName) {
      var pipeChannels = sinkChannels[sinkName]||[];
      pipeChannels.reduce(function(tgt, channelName) {
        var list = tgt[channelName] || [];
        if (list.indexOf(sinkName) === -1) {
          list.push(sinkName);
        }
        tgt[channelName] = list;
        return tgt;
      }, resolvedChannelSinks);
    });
    for (var k in resolvedChannelSinks) {
      resolvedChannelSinks[k] = unique(resolvedChannelSinks[k]);
    }

    // Resolving every channel level.
    // Max between channel level and the minimal linked sink
    for (var channelName in channelMinLevel) {
      //updateEndPoint(channelName);
      resolvedChannelLevels[channelName] = Math.max(
        channelMinLevel[channelName],
        (resolvedChannelSinks[channelName]||[]).reduce(reduceMinSinkLevel, LVL_IGNORE)
        );
    }
  }

  function updateIfDirty() {
    if (dirty) {
      applyPipeRules();
      dirty = false;
    }
  }

  function setChannelMinLevel(name, level) {
    // TODO: check level
    var oldLevel = channelMinLevel[name];
    channelMinLevel[name] = level;
    dirty = true;
    return oldLevel;
  }

  function setSinkMinLevel(name, level) {
    // TODO: check level
    sinkMinLevel[name] = level;
    dirty = true;
  }

  function doMute(source, names, opt_mute) {
    names = convertArg(names).filter(isntWildCard);
    opt_mute = (!!libutils.defv(opt_mute,1))?1:0;
    if (names.length) {
      var changed = false;
      names.forEach(function(name) {
        if (opt_mute !== source[name]) {
          changed = true;
          source[name] = opt_mute;
        }
      });
      dirty = dirty || changed;
    }
  }
  function muteSinks(sinks, mute) {
    doMute(mutedSinks, sinks, mute);
  }
  function muteChannels(channels, mute) {
    doMute(mutedChannels, channels, mute);
  }
  function isSinkMuted(sinkType) {
    return !!mutedSinks[sinkType];
  }
  function isChannelMuted(channel) {
    return !!mutedChannels[channel];
  }


  function pipeChannelsToSinks(channels, sinks) {
    channels = convertArg(channels);
    sinks = convertArg(sinks);
    for (var cc=0; cc < channels.length; cc++) {
      var channel = channels[cc];
      for (var ss=0; ss < sinks.length; ss++) {
        pipeRules[channel] = (pipeRules[channel]||[]).concat([sinks[ss]]);
      }
    }
    for (var k in pipeRules) {
      pipeRules[k] = unique(pipeRules[k]);
    }
    dirty = true;
    return singleton;
  }

  function convertArg(arg) {
    return isString(arg)? arg.split(','): (arg||[]);
  }

  function dontPipeChannelsToSinks(channels, sinks) {
    channels = convertArg(channels).filter(isntWildCard);
    sinks = convertArg(sinks).filter(isntWildCard);
    if (channels.length && sinks.length) {
      channels.forEach(function(v) {
        excludedChannelSinks[v] = unique((excludedChannelSinks[v]||[]).concat(sinks));
      });
      dirty = true;
    }
    return singleton;
  }

  function willPipe(channel, level) {
    var
      duration = performanceNow(),
      result = true;
    if (level < LVL_WARN) {
      updateIfDirty();
      result = resolvedChannelLevels[channel] <= level;
    }
    metrics.test += performanceNow() - duration;
    return result;
  }

  function LogContext(channel, lvl, args) {
    RO(this, {
      channel:   channel,
      lvl:       lvl,
      level:     LEVELS[lvl],
      args:      args,
      timeStamp: Date.now()
    });
  }

  RO(LogContext[STR_PROTOTYPE], {
    // Expand late binding arguments (closures).
    expand: function() {
      var self = this;
      if (self.expanded === undefined) {
        self.expanded = ArrProto.map.call(self.args, function(arg) {
          if (isFunction(arg)) {
            arg = arg();
          }
          return arg;
        });
      }
      return self.expanded;
    },
    // Stringify arguments, especially objects, as JSON strings.
    // Return a single string with all arguments joined with spaces.
    stringify: function() {
      var self = this;
      if (self.stringified === undefined) {
        self.stringified = self.expand().map(function(arg) {
          var to = typeof arg;
          if (to === 'string' || to === 'number') {
            return arg;
          }
          return JSON.stringify(arg);
        }).join(' ');
        if (self.lvl === LVL_TRACE) {
          // Add stack trace.
          var jqueryre = /\/jquery(?:\.min)?\.js:\d+$/;

          var stack = new Error().stack.split("\n");
          // Remove logger calls from the stack.
          while (stack.length && !stack.shift().startsWith('logger.'+STR_PROTOTYPE)) {
          }
          // Filter out jquery internals.
          stack = stack.filter(function(item) {
            return !jqueryre.test(item);
          });
          self.stringified += "\n" + stack.join("\n");
        }
      }
      return self.stringified;
    }
  });

  function doLogFromLogger(channel, level, argsIn) {
    dispatch(channel, level, new LogContext(channel, level, ArrProtoSlice.call(argsIn)));
  }

  function dispatch(channel, level, logContext) {
    updateIfDirty();
    if (level >= LVL_WARN || (resolvedChannelLevels[channel] <= level)) {
      var
        channelSinks = resolvedChannelSinks[channel] || [],
        exclusions = excludedChannelSinks[channel] || [];
      if (level === LVL_WARN || level === LVL_ERROR ) {
        warn_error_sinks.forEach(function(channel) {
          if (
              sinkMinLevel[channel] &&
              exclusions.indexOf(channel) === -1 &&
              channelSinks.indexOf(channel) === -1
          ) {
            channelSinks.push(channel);
          }
        });
      }

      channelSinks.forEach(function(sinkName) {
        if (sinkMinLevel[sinkName] <= level) {
          var
            duration = performanceNow(),
            ms = metrics.sinks;
          (sinkInstances[sinkName] || []).forEach(function(sink) {
            sink.handle(logContext);
          });
          duration = performanceNow() - duration;
          ms[sinkName] = (ms[sinkName]||0) + duration;
        }
      });
    }
  }

 //////////////////////////////////////////////////////////////////////////////////
  //
  // liblog: browserConsole
  //
  (function() {
    if (browserConsole) {
      var
        asString = !browserConsole.exception && (window.chrome === undefined), // Exception true for FireBug, false for Firefox.
        levelMapping = {};

      levelMapping[STR_TRACE] = STR_DEBUG;
      levelMapping[STR_INFO]  = STR_LOG;

      for (var name in levelMapping) {
        if (!isFunction(browserConsole[name])) {
          browserConsole[name] = browserConsole[levelMapping[name]];
        }
      }

      //addSinkType(STR_CONSOLE);
      var instance = {
        handle: function(context) {
          var args = [ context.channel ];
          if (asString) {
            args.push(context.stringify());
          } else {
            // Must perform a copy, as we don't want to modify the expand array.
            args = args.concat(context.expand());
          }
          // browserConsole[context.level].apply(browserConsole, args);
        }
      };

      registerSink(instance, STR_CONSOLE, STR_CONSOLE);
//      setSinkMinLevel(STR_CONSOLE, LVL_TRACE);
//      sinkInstances[STR_CONSOLE] = [instance];
    }
  })();

  //////////////////////////////////////////////////////////////////////////////////
  //
  // liblog: onscreen console
  //
  var OnScreenSink = (function() {
    var
      doc = document,
      eolre = new RegExp("\n", 'g'),
      css_node = doc.createElement('style');

    css_node.innerHTML = [
      STR_DOT_LIBLOG + '{border:1px solid rgb(50,50,50);background-color:rgba(200,200,200,0.5);font-size: 12px;color:rgb(0,0,0);overflow:auto;font-family:monospace;display:block!important;}',
      ', '+ STR_DOT_LIBLOG + ' table {width:100%;top:0;left:0;z-index:99;}',
      '* {padding:0; margin: 0;}',
      '.error{color:rgb(250,0,0);font-weight:200;}',
      '.warn{color: DarkGoldenRod;}',
      '.debug{color:rgb(0,10,128);}',
      STR_TABLE+' {position:absolute;z-index:99;table-layout:auto}',
      STR_TABLE+' tr{height:auto;}',
      STR_TABLE+' tr:nth-child(even){background-color:rgba(0,0,0,0.1);}',
      STR_TABLE+' td{padding-left:0.25em;vertical-align:top;white-space:pre-line;}',
      STR_TABLE+' td.msg{word-break:keep-all;}',
      STR_TABLE+' .ts{max-width:1em;}'
    ].join('\n' + STR_DOT_LIBLOG + ' ');
    doc.head.appendChild(css_node);

    function OnScreenSink(name, args) {
      var
        self = this,
        init = false,
        valid = true;

      if (!isA(self, OnScreenSink)) {
        return new OnScreenSink(name, args);
      }
      registerSink(self, 'onscreen', name);
      if ( isString(args) ) {
        args = {
          div: args
        };
      }

      RO(self, {
        args: args,
      });

      function handle(context) {
        if (!valid) {
          return;
        }

        libutils.ready.then(function() {
          var
            root = doc.getElementById(args.div),
            table = args.table;

          if (!init) {
            if (!root) {
              valid = false;
              return;
            }
            root.className += ' ' + STR_LIBLOG;
            if ( table ) {
              root.appendChild(doc.createElement(STR_TABLE));
            }
            init = true;
          }
          dump(context, root, table);
        });
      }
      RO(self, {handle: handle});
      return self;
    }
    function createNode(type, cssclass, html, parent) {
      var node = doc.createElement(type);
      node.className = cssclass;
      node.innerHTML = html;
      if(parent) {
        parent.appendChild(node);
      }
      return node;
    }
    function dump(context, root, astable) {
      var
        noEOL = context.stringify().replace(eolre, "<br>&nbsp;&nbsp;&nbsp;&nbsp;\n").replace(/\:/g, ':'),//&#8203;'),
        cName = context.level;
      if (astable) {
        var
          table = root.getElementsByTagName(STR_TABLE)[0],
          tr = createNode('tr', cName,'', table);

        createNode('td', 'ts', context.timeStamp, tr);
        createNode('td', 'ch', context.channel, tr);
        createNode('td', 'msg', noEOL, tr);
      } else {
        createNode(
          'span',
          cName,
          context.timeStamp + '  ' + context.channel + ': ' + noEOL,
          root
        );
        createNode('br', '', '', root);
      }
    }
    return OnScreenSink;
  })();

  function registerSink(item, type, name) {
    //addSinkType(type);
    setSinkMinLevel(type, LVL_TRACE);
    sinkInstances[type] = sinkInstances[type]||[];
    sinkInstances[type].push(item);
    ODPs(item, {
      min: {
        set: function(level) {
          setSinkMinLevel(type, level);
        },
        get: function() {
          return sinkMinLevel[type];
        }
      }
    });
    RO(item, {
      name: name,
      type: type
    });
    return singleton;
  }


  function LoggerPipeToSinks(sinks) {
    pipeChannelsToSinks([this.channel], sinks);
    return this;
  }
  function ChannelLogger(channel) {
    var self = this;
    if (!isA(self, ChannelLogger)) {
      return new ChannelLogger(channel);
    }

    //addChannel(channel);
    setChannelMinLevel(channel, LVL_TRACE);
    function getChannelMinLevel() {
      return channelMinLevel[channel];
    }
    ODPs(RO(self, {channel: channel}), {
      min: {
        get: getChannelMinLevel,
        set: function(lvl) {
          setChannelMinLevel(channel, lvl);
        }
      },
      ends: {
        get: function() {
          updateIfDirty();
          return (resolvedChannelSinks[channel]||[]).length;
        }
      }
    });
    ODPs(self, NUM_LEVELS.reduce(function(tgt, level) {
      var lvl = LEVELS[level];
      tgt['can'+lvl] = {
        get: function() {
          return willPipe(channel, level);
        }
      };
      return tgt;
    }, {}));
    return self;
  }

  RO(RO(RO(ChannelLogger[STR_PROTOTYPE], NUM_LEVELS.reduce(function(tgt, level) {
      tgt[LEVELS[level]] = function() {
        var
          self = this,
          channel = self.channel,
          start = performanceNow();

        metrics.calls++;
        if (willPipe(channel, level)) {
          metrics.piped++;
          dispatch(channel, level, new LogContext(channel, level, ArrProtoSlice.call(arguments)));
        }
        updateLogMetric(channel, level, performanceNow() - start );
        return self;
      };
      return tgt;
    }, {})
  ),{
    pipe:         LoggerPipeToSinks,
  }), LVLS_SHORT);

  ChannelLogger[STR_PROTOTYPE].pipeToSinks = LoggerPipeToSinks; // TODO: legacy

  function dbgDump() {
    var
      BL = browserConsole.log,
      STR_DBG_DUMP='dbgDump';
    updateIfDirty();
    browserConsole.group(STR_DBG_DUMP);
    BL('skmin', sinkMinLevel);
    BL('chmin', channelMinLevel);
    BL('skins', sinkInstances);
    BL('pipes', pipeRules);
    BL('!chsk', excludedChannelSinks);
    BL('ch-lv', resolvedChannelLevels);
    BL('ch-sk', resolvedChannelSinks);
    BL('sk-ch', resolvedSinkChannels);
    browserConsole.groupEnd(STR_DBG_DUMP);
  }

  function Log(channel) {
    return ChannelLogger(channel);
  }

  singleton = Log;
  RO(Log, LVLS_SHORT);

  Object.defineProperty(Log, 'dev', {
    set: function(value) {
      warn_error_sinks = (!!value)? [STR_REMOTE, STR_CONSOLE]: [STR_REMOTE];
    }
  });

  Object.defineProperty(Log, 'metrics', {
    get: function() {
      return libutils.copy(metrics);
    }
  });

  RO(window, {
    liblog: RO(Log, {
      can             : willPipe,
      sinks: {
        mute:     muteSinks,
        muted:    isSinkMuted,
        minLevel: setSinkMinLevel,
        add:      registerSink,
      },
      channels: {
        mute: muteChannels,
        muted:    isChannelMuted,
        minLevel: setChannelMinLevel,
      },
      OSD             : OnScreenSink,
      pipe            : pipeChannelsToSinks,
      nopipe          : dontPipeChannelsToSinks,
      dbgDump         : dbgDump,
      LEVELS          : libutils.copy(LEVELS.filter(function(v) {return !!v;})),
      Channel         : ChannelLogger,
      Logger          : ChannelLogger,
    })
  });
})(window);

(function(window) {
  if (window.EventEmitter) {
    return;
  }

  var RO = window.libutils.RO;
  function EventEmitter() {
    if (!(this instanceof EventEmitter)) {
      return new EventEmitter();
    }
    var
      self = this,
      allHandlers = {};
    function getEvents(name) {
      return name.split(' ');
    }
    function addListener(eventNames, closure, once) {
      getEvents(eventNames).forEach(function(eventName) {
        var handlers = allHandlers[eventName] = (allHandlers[eventName] || []);
        handlers.push({
          c: closure,
          o: once
        });
      });
      return self;
    }
    function on(eventNames, closure) {
      return addListener(eventNames, closure, 0);
    }
    function one(eventNames, closure) {
      return addListener(eventNames, closure, 1);
    }
    function off(eventNames, closure) {
      if (eventNames == null) {
        allHandlers = {};
      } else {
        getEvents(eventNames).forEach(function(eventName) {
          var doDelete = (closure == null)  ||
            !(allHandlers[eventName] = (allHandlers[eventName] || [])
                .filter(function(v) {
                  return v.c !== closure;
                })
            ).length;
          if( doDelete ) {
            delete allHandlers[eventName];
          }
        });
      }
      return self;
    }
    function emit(eventName, data) {
      if (arguments.length > 2 || typeof eventName !== 'string') {
        throw new TypeError('expected: emit(<string>, [data])');
      }
      var
        event = RO({
          type:      eventName,
          data:      data,
          timestamp: performance.now(),
          target:    self,
          namespace:  '', // jquery quirk
        });

      var doDelete = !(allHandlers[eventName] =
        (allHandlers[eventName] || []).filter(function(v) {
          var result = v.c.call(self, event, event.data );
          return !!!v.o;
        })).length;
      if( doDelete ) {
        delete allHandlers[eventName];
      }
    }

    RO(self, {
      on:     on,
      bind:   on,
      one:    one,
      off:    off,
      unbind: off,
      emit:   emit
    });
  }
  window.EventEmitter = EventEmitter;
})(this);


/*
 * (c)2017-2018 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function UMD(root, moduleName, factory) {
  var STR_OBJECT = 'object';
  if(typeof exports === STR_OBJECT && typeof module === STR_OBJECT) {
    module.exports = factory();
  } else if(typeof define === 'function' && define.amd) {
    define([], factory);
  } else if(typeof exports === STR_OBJECT) {
    exports[moduleName] = factory();
  } else {
    root[moduleName] = root[moduleName] || factory();
  }
})(this, 'libpubsub', function() {
  /**
   * Provides services related to publish/subscribe
   * @file libpubsub.js
  **/
  /**
   * Provides services related to publish/subscribe
   * @namespace libpubsub
  **/
  var
    API = {},
    STR_SUBSCRIBE   = 'SUBSCRIBE',
    STR_UNSUBSCRIBE = 'UN' + STR_SUBSCRIBE,
    STR_CONNECT     = 'CONNECT',
    STR_CONNECTED   = STR_CONNECT+'ED',
    STR_DISCONNECT  = 'DIS' + STR_CONNECT,
    STR_PUBLISH     = 'PUBLISH',
    STR_REDIRECT    = 'REDIRECT',
    STR_ONREDIRECT    = 'onredirect',
    STR_MANIFEST    = 'MANIFEST',
    STR_ONMANIFEST = 'onmanifest',
    STR_LOBBY        = 'LOBBY',
    STR_LOBBY_PREFIX = '__lobby.',
    STR_ONOPEN       =  'onopen',
    STR_ROUTING_LC    = 'routing',
    STR_ONROUTING    = 'on' + STR_ROUTING_LC,
    STR_RECONNECT = 'RECONNECT',
    STR_ROUTING   = 'ROUTING',
    STR_ONCLOSE   = 'onclose',
    STR_ERROR     = 'ERROR',
    STR_ONERROR   = 'onerror',
    STR_ONMESSAGE = 'onmessage',
    STR_UNDEFINED = 'undefined',
    WILDCARD_TEST = /[\*\?]/,
    BINDINGS = [STR_ONOPEN, STR_ONCLOSE, STR_ONMESSAGE, STR_ONERROR],
    DEFAULT_PUBSUB_EXCHANGE = '',
    PUBSUB_PROTOCOL_VERSION=1,
    STR_URI_DEFAULT_PORT = 9012,
    STR_URI_PATH = 'websocket/pubsub',
    DEFAULT_URL,
    ObjectDefineProperty = Object.defineProperty,
    JSONStringify = JSON.stringify,
    JSONParse = JSON.parse,
    thisHostName = '127.0.0.1',
    thisProtocol = 'ws:',
    WebSocket, browserWindow;

  try {
    thisProtocol = protocol = location.protocol.toLowerCase().replace('http', 'ws');
    thisHostName = location.hostname;
  } catch(e) {
  }

  if (STR_UNDEFINED !== typeof window) {
    browserWindow = window;
    WebSocket = browserWindow.WebSocket;
  } else if (STR_UNDEFINED !== typeof global) {
    WebSocket = global.WebSocket;
  }

  function BuildURL(host, port) {
    return [
      (host || thisHostName),
      ':', (port || STR_URI_DEFAULT_PORT),
      '/', STR_URI_PATH,
      '?version=', PUBSUB_PROTOCOL_VERSION
    ].join('');
  }

  DEFAULT_URL = thisProtocol + '//' + BuildURL(thisHostName);

  function RO(who, values) {
    for (var k in values) {
      ObjectDefineProperty(who, k, {
        enumerable: true,
        value: values[k]
      });
    }
    return who;
  }

  function call(who, what, a1, a2, a3) {
    return (typeof who[what] === 'function')?
      who[what].call(who, a1, a2, a3):
      null;
  }

  function unique(array) {
    return array.filter(function(v,i,src) {
      return src.indexOf(v) === i;
    });
  }

  function MirrorReadyStates(src, dest) {
    RO(dest, {
      CONNECTING: src.CONNECTING,
      OPEN:       src.OPEN,
      CLOSING:    src.CLOSING,
      CLOSED:     src.CLOSED
    });
  }

  function AddReadyStateConstantsToInstance(socket) {
    if (socket instanceof WebSocket) {
      var src = WebSocket.super_ || WebSocket;
      MirrorReadyStates(src, socket);
      if (browserWindow) {
        browserWindow.addEventListener('beforeunload', function() {
          if (socket.readyState <= socket.OPEN) {
            socket.close();
          }
        });
      }
    }
  }

  function ForwardTransportReadyState(self, transport) {
    AddReadyStateConstantsToInstance(transport);
    MirrorReadyStates(transport, self);

    ObjectDefineProperty(self, 'readyState', {
      get: function() {
        return transport.readyState;
      }
    });
  }

  function sendToSocket(socket, payload, arg2, arg3, arg4) {
    if (socket instanceof WebSocket) {
      payload = JSONStringify(payload);
    }
    return socket.send(payload, arg2, arg3, arg4);
  }

  function TransportMulticast(transport) {
    var
      self = this,
      closures = BINDINGS.reduce(function(tgt, v) {
        tgt[v] = [];
        return tgt;
      }, {});

    if (transport instanceof TransportMulticast) {
      throw new Error('Can\'t chain TransportMulticasts' );
    }

    function makeBinding(name) {
      var callbacks = closures[name];
      return {
        get: function() {
          return function() {
            var args = arguments;
            callbacks.forEach(function(closure) {
              try {
                closure.apply(self, args);
              } catch(e){}
            });
          };
        },
        set: function(closure) {
          if(closure) {
            callbacks.push(closure);
          } else {
            if (callbacks.length > 1) {
              throw new Error('use .off instead');
            }
            callbacks =[];
          }
        }
      };
    }
    RO(self, {
      off: function(bindings) {
        for (var name in bindings) {
          var
            cb = closures[name],
            io = cb.indexOf(callbacks);
          if (io !== -1) {
            cb.splice(io,1);
          }
        }
      },
      send: function(payload, b,c,d) {
        return sendToSocket(transport, payload, b,c,d);
      },
      close: function() {
        return transport.close();
      },
    });

    ForwardTransportReadyState(self, transport);

    BINDINGS.forEach(function(v) {
      ObjectDefineProperty(self, v, makeBinding(v));
      self[v] = transport[v];
      transport[v] = self[v];
    });
  }

  var
    multicastSockets = {},  // key: url, value: multicast
    redirects = {}; // key: original url, value: multicast
  function getQueryParam(src, name) {
    var q = src.match(new RegExp('[?&]' + name + '=([^&#]*)'));
    return q && q[1];
  }
  function getTransportMulticast(wsUrl) {
    var
      key = wsUrl,
      redirectURL = redirects[key],
      multicastSocket = multicastSockets[redirectURL] || multicastSockets[key];

    if (!multicastSocket) {
      var socket = new WebSocket(redirectURL || wsUrl);
      multicastSocket = multicastSockets[key] = new TransportMulticast(socket);

      if ((key !== redirectURL) && getQueryParam(key, 'hub')) {
        multicastSocket[STR_ONMESSAGE] = function(msg) {
          try {
            msg = JSON.parse(msg.data);
            if (msg.type && msg.type === STR_REDIRECT) {
              redirects[key] = msg.body;
              this.redirecting = true;
              this.close();
            }
          } catch(e){
          }
        };
        multicastSocket[STR_ONCLOSE] = function(e) {
          if (!this.redirecting) {
            delete redirects[key];
          }
        };
      }
      multicastSocket[STR_ONCLOSE] = function() {
        delete multicastSockets[key];
      };
    }
    return multicastSocket;
  }

  // Define router
  function extractDataFromEvent(evt) {
    var data = evt.data;
    return JSONParse(('string' === typeof data)? data: JSON.stringify(data));
  }

  function NotifyRoutingEvent(who, active) {
    return call(who, STR_ONROUTING, {
      type: STR_ROUTING_LC,
      data: {
        active: active
      }
    });
  }

  var routerIDs = 0;
  function Router(downstream, makeUpstream, wsURL) {
    var
      self = this,
      queue = [],
      metrics = {
        inboundused: 0,
        inbound: 0,
        outbound: 0
      },
      wantClose = false,
      upstream,
      reconnectingTS,
      reconnectUpstreamTO,
      clientRoutes = {},
      routerID = routerIDs++;

    if (!makeUpstream) {
      makeUpstream = function MakeUpstreamTransportMulticast() {
        return getTransportMulticast(wsURL || DEFAULT_URL);
      };
    }

    function NotifyRouting(active) {
      var payload = {
        type: STR_ROUTING,
        active: active
      };
      Object.keys(clientRoutes).forEach(function(id) {
        downstream.send(payload, id);
      });
      NotifyRoutingEvent(self, active);
    }
    function ReconnectUpstream() {
      if (!reconnectingTS) {
        reconnectingTS = performance.now();
        NotifyRouting(false);
      }
      reconnectUpstreamTO = clearTimeout(reconnectUpstreamTO);
      reconnectUpstreamTO = setTimeout(ConnectUpstream, 1000);
    }

    function ConnectUpstream() {
      if (upstream && !(upstream instanceof TransportMulticast)) {
        BINDINGS.forEach(function(v) {
          delete upstream[v];
        });
        upstream.close();
      }
      upstream = makeUpstream();
      upstream[STR_ONMESSAGE] = function(evt) {
        var
          payload,
          data = extractDataFromEvent(evt),
          routes    = data.rte,
          noop = delete data.rte,
          dataStr  = JSONStringify(data),
          includeInMetrics = false,
          dataLength = dataStr.length;

        metrics.inbound += dataLength;
        // TODO: implement multicast messages
        if (routes) {
          routes.forEach(function(thisRoute) {
            var
              splitRoute = thisRoute.split('|'),
              localRoute = splitRoute.shift(),
              localSplit = localRoute.split(':'),
              targetRouterID = localSplit[0],
              localClientID = localSplit[1];

            if (targetRouterID == routerID) {
              includeInMetrics = true;
              payload = JSONParse(dataStr);
              payload.rte = [splitRoute.join('|')];
              if (!splitRoute.length) {
                delete payload.rte;
              }
              downstream.send(payload, localClientID);
            }
          });

          if (includeInMetrics) {
            metrics.inboundused += dataLength;
          }
        }
      };
      upstream[STR_ONCLOSE] = upstream[STR_ONERROR] = function(e) {
        var isClose = e.type === 'close';
        if (wantClose) {
          downstream.close();
          call(self, isClose? STR_ONCLOSE: STR_ONERROR, e);
          queue=[];
        } else if (isClose) {
          ReconnectUpstream();
        }
      };

      upstream[STR_ONOPEN] = function() {
        if (reconnectingTS) {
          reconnectingTS = 0;
          // Notify clients of reconnection so they
          // can re-register
          NotifyRouting(true);
          while(queue.length) {
            sendToSocket(upstream, queue.shift());
          }
          call(self, 'onconnected');
        } else {
          while(queue.length) {
            sendToSocket(upstream, queue.shift());
          }
          call(self, STR_ONOPEN);
        }
      };
    }

    ConnectUpstream();
    function appendRoute(data, from) {
      var currentRoute = (data.rte||[])[0];
      data.rte = [routerID + ':' + from + (currentRoute? ('|'+currentRoute):'')];
      return data;
    }

    downstream.onclient = function(id, active) {
      if (!active) {
        var
          routes = clientRoutes[id];
//        for (var ii = 0; ii < routes.length; ii++) {
//          sendToSocket(upstream, {type: 'BYE', rte: [routes[ii]]});
//        }
        delete clientRoutes[id];
      } else {
        clientRoutes[id] = [];
      }
    };

    downstream[STR_ONCLOSE] = function() {
      wantClose = true;
      upstream.close();
    };
    downstream[STR_ONMESSAGE] = function(evt) {
      // TODO: multiplex heartbeat
      var
        from = evt.from,
        data = appendRoute(extractDataFromEvent(evt), from),
        routes = clientRoutes[from] || [];

      clientRoutes[from] = unique(routes.concat(data.rte[0]));
      metrics.outbound += JSONStringify(data).length;
      if (!upstream || upstream.readyState < upstream.OPEN) {
        queue.push(data);
      } else {
        if (upstream.readyState > upstream.OPEN && upstream.redirecting && data.type === STR_CONNECT) {
          // Silently fail
          return;
        }
        sendToSocket(upstream, data);
      }
    };
    ForwardTransportReadyState(self, upstream);

    function close() {
      wantClose = true;
      downstream.close();
    }
    self.upstream = upstream;
    self.downstream = downstream;
    self.metrics = metrics;
  }

  function Packet(exchange, type, topic, id, payload) {
    var result = {
      xch:    exchange,
      type:   type,
      topic:  topic,
      subid:  id,
      body:   payload,
    };

    for (var k in result) {
      if (result[k] == null) {
        delete result[k];
      }
    }
    return result;
  }

  function Client(exchange, socket) {
    var
      self = this,
      subscriptions = {}, // key: subid, val: {channel: channel, callback: callback}
      connectedCB,
      connectedErrorCB,
      connectTOHandle,
      incrementalSubID = 1,
      queue = [],
      exchangeArgs,
      metrics = {
        downtime: 0,
      },
      routingLostTS = 0;

    if (!socket) {
      socket = new WebSocket(DEFAULT_URL);
    }
    if (!exchange) {
      exchange = DEFAULT_PUBSUB_EXCHANGE;
    }

    AddReadyStateConstantsToInstance(socket);

    socket[STR_ONMESSAGE] = function(evt) {
      var
        type,
        data = extractDataFromEvent(evt);

      if (API.log) {
        API.log('>>>', data, JSON.stringify(data).length);
      }

      if (data) {
        type = data.type;
        if (type === STR_CONNECTED) {
          connectTOHandle = clearTimeout(connectTOHandle);
          if (routingLostTS) {
            metrics.downtime += performance.now() - routingLostTS;
            routingLostTS = 0;
            for (var handle in subscriptions) {
              Dispatch(Packet(exchange, STR_SUBSCRIBE, subscriptions[handle].topic, handle));
            }
          } else {
            if (connectedCB) {
              connectedCB.call(self, data);
            }
            call(self, STR_ONOPEN);
          }
        } else if (type === STR_PUBLISH || type === STR_LOBBY) {
          var callbackDesc = subscriptions[data.subid];
          if (callbackDesc) {
            var map = {
              xch: 'exchange',
            };
            for (var k in map) {
              data[map[k]] = data[k];
              delete data[k];
            }
            data.subscription = callbackDesc.topic;
            callbackDesc.cb.call(self, data);
          }
        } else if (type === STR_MANIFEST) {
          call(self, STR_ONMANIFEST, data);
        } else if (type === STR_ERROR) {
          call(self, STR_ONERROR, data);
        } else if (type === STR_ROUTING) {
          if (data.active) {
            Resubscribe();
          } else {
            routingLostTS = performance.now();
          }
          NotifyRoutingEvent(self, data.active);
        } else if (type === STR_REDIRECT) {
          call(self, STR_ONREDIRECT, data.body);
        } else {
          console.warn('unhandled', data);
        }
      }
    };

    socket[STR_ONCLOSE] = function(e) {
      call(self, STR_ONCLOSE, e);
    };
    socket[STR_ONERROR] = function(e) {
      call(self, STR_ONERROR, e);
    };

    socket[STR_ONOPEN] = function() {
      while(queue.length) {
        sendToSocket(socket, queue.shift());
      }
    };

    function Dispatch(payload) {
      // TODO: queue?
      if (API.log) {
        API.log('<<<', payload, JSONStringify(payload).length);
      }
      if (routingLostTS || socket.readyState < socket.OPEN) {
        queue.push(payload);
      } else {
        sendToSocket(socket, payload);
      }
    }
    function Close() {
      subscriptions = {};
      socket.close();
    }

    function Resubscribe() {
      var tsTemp = routingLostTS; // bypass queue
      routingLostTS = 0;
      Connect(connectedCB, connectedErrorCB, exchangeArgs);
      routingLostTS = tsTemp;
    }

    function Connect(connectCB, connectErrorCB, args) {
      connectedCB = connectCB;
      connectedErrorCB = connectErrorCB;
      clearTimeout(connectTOHandle);
      connectTOHandle = setTimeout(function() {
        if (connectedErrorCB) {
          connectedErrorCB.call(self, 'timed out', args);
        }
      }, 10000);
      exchangeArgs = args;
      Dispatch(Packet(exchange, STR_CONNECT, null, null, args));
    }
    function Disconnect() {
      connectTOHandle = clearTimeout(connectTOHandle);
      Dispatch(Packet(exchange, STR_DISCONNECT));
    }
    function Subscribe(topic, callback) {
      var
        handle = ''+incrementalSubID++;
        subscriptions[handle] = {
          topic: topic,
          cb: callback
        };
      Dispatch(Packet(exchange, STR_SUBSCRIBE, topic, handle));
      return handle;
    }

    function SubscribePresence(topic, callback) {
      return Subscribe(STR_LOBBY_PREFIX + topic, callback);
    }
    function UnsubscribePresence(topic) {
      for (var handle in subscriptions) {
        var subscription = subscriptions[handle];
        if (subscription.topic === topic) {
          Unsubscribe(handle);
        }
      }
    }
    function Unsubscribe(topic) {
      Object.keys(subscriptions).reduce(function(tgt, handle) {
        var desc = subscriptions[handle];
        if( desc.topic === topic ) {
          tgt.push(handle);
        }
        return tgt;
      }, []).forEach(function(handle) {
        delete subscriptions[handle];
        Dispatch(Packet(exchange, STR_UNSUBSCRIBE, null, handle));
      });
    }

    function UnsubscribeAll() {
      for (var handle in subscriptions) {
        Unsubscribe(handle);
      }
    }

    function GetServerState() {
      Dispatch(Packet(exchange, STR_MANIFEST));
    }

    function Publish(topic, payload) {
      if (WILDCARD_TEST.exec(topic)) {
        throw new Error('Publish to wildcard not supported topic=' + topic);
      }
      Dispatch(Packet(exchange, STR_PUBLISH, topic, null, payload));
    }

    function Teardown() {
      Disconnect();
      socket.close();
      socket = null;
    }

    ObjectDefineProperty(self, 'metrics', {
      enumerable: true,
      get: function() {
        return JSONParse(JSONStringify(metrics));
      }
    });
    ObjectDefineProperty(self, 'topics', {
      enumerable: true,
      get: function() {
        return Object.keys(subscriptions).map(function(handle) {
          return subscriptions[handle].topic;
        });
      }
    });
    ObjectDefineProperty(self, 'handles', {
      enumerable: true,
      get: function() {
        return Object.keys(subscriptions).reduce(function(acc, handle) {
          acc[handle] = subscriptions[handle].topic;
          return acc;
        }, {});
      }
    });

    RO(self, {
      socket:               socket,
      exchange:             exchange,
      debug: {
        exchange:             GetServerState,
      },
      close:                Close,
      connect:              Connect,
      disconnect:           Disconnect,
      publish:              Publish,
      subscribe:            Subscribe,
      subscribePresence:    SubscribePresence,
      unsubscribe:          Unsubscribe,
      unsubscribePresence:  UnsubscribePresence,
    });
  }
  return RO(API, {
    defaultExchange:    DEFAULT_PUBSUB_EXCHANGE,
    TransportMulticast: TransportMulticast,
    Client:             Client,
    Router:             Router,
    URL:                DEFAULT_URL,
    BuildURL:           BuildURL,
  });
});

/*
 * (c)2012-2017 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function(context) {
  var
    VERSION = 1,
    existing = context.libframesocket;

  if (existing) {
    if (existing.version !== VERSION) {
      console.warn('libframesocket override', existing.version);
    }
    return;
  }
/**
 * Provides a Websocket-like interface to postMessage-based
 * messaging between iframes, or inside a single iframe.
 *
 * A client will send connection requests (via postMessage) through the window
 * hierarchy it has access to (window.parent, and iframes within that window),
 * stopping when it hits the root or a CORS exception.
 *
 * The first server to respond will establish a private MessageChannel between
 * itself and the client, and assign it an ID.
 * Further messaging will go through this MessageChannel.
 *
 * @requires HTML5.MessageChannel
 * @namespace libframesocket
 * @example
 * // Setup a local socket server.
 * // This code could be in the parent iframe.
 * var server = new libframesocket.Server('foo');
 * server.onclient = function() {
 *   console.log(arguments);
 * }
 * // Request a server on the foo channel.
 * var client = new libframesocket.Client('foo');
 * client.onopen = function() {
 *   console.log(open);
 * }
**/
  var
    noop = function(){},
    ObjectDefineProperty = Object.defineProperty,
    RO = function(who, what) {
      for (var name in what) {
        ObjectDefineProperty(who, name, {
          enumerable: true,
          value: what[name]
        });
      }
      return who;
    },
    call = function(who, what, a1, a2, a3) {
      return (typeof who[what] === 'function')? who[what].call(who, a1, a2, a3): null;
    },
    logError = noop;

  var
    STATE_CONNECTING = 0,
    STATE_OPEN = 1,
    STATE_CLOSING = 2,
    STATE_CLOSED = 3,
    STATE_HASH = {
      CONNECTING: STATE_CONNECTING,
      OPEN:       STATE_OPEN,
      CLOSING:    STATE_CLOSING,
      CLOSED:     STATE_CLOSED,
    },

    STR_ACTIVE = 'active',
    STR_ON = 'on',
    STR_ONCLIENT = STR_ON + 'client',
    STR_CLOSE = 'close',
    STR_ONOPEN = 'onopen',
    STR_ONCLOSE = STR_ON + STR_CLOSE,
    STR_ONERROR = 'onerror',
    STR_MESSAGE = 'message',
    STR_ONMESSAGE = STR_ON + STR_MESSAGE,
    STR_UNLOAD = 'unload',
    STR_FRAMESOCKET = 'libframesocket',
    STR_FIN = 'FIN',
    STR_SYN = 'SYN',
    STR_SYN_ACK = 'SYN-ACK',
    UNDEF,
    connectTimeout = 15000,
    MIN_CONNECT_TIMEOUT = 33,
    hookWindowEvent = context.addEventListener,
    unhookWindowEvent = context.removeEventListener,
    setTimeout = context.setTimeout,
    clearTimeout = context.clearTimeout;

  function neuter(who) {
    who[STR_ONMESSAGE] = who[STR_ONCLOSE] = who[STR_ONOPEN] = who[STR_ONERROR] = who[STR_ONCLIENT] = null;
  }

  function post(target, msg, ports, a3) {
    target.postMessage(msg, ports, a3);
  }

  var
    PAYLOAD_FIN =     {type: STR_FIN};

  function makeMessageChannel(closure) {
    var ch = new MessageChannel();
    ch.port1[STR_ONMESSAGE] = closure;
    return ch;
  }
  // TODO: add timeout
  function postAsync(port, payload, async, that) {
    post(port, payload, async? [makeMessageChannel(function(evt) {
      async.call(that||this, evt);
    }).port2]: UNDEF);
  }
  function sendMessage(port, payload, async, that) {
    postAsync(port, {type: STR_MESSAGE, data: payload}, async, that);
  }


  /**
   * Triggered when a client sends a message to the server
   * @callback OnClientMessage
   * @member {object|string}  data    Message data
   * @member {string}         from    Sender ID
   * @member {type}           type    Event type. Should be "message"
   * @member {closure}        [reply] Closure to call if a response is required
  **/

  /**
   * Triggered when a client connects/disconnects from the server
   * @callback OnClient
   * @memberof libframesocket
   * @param {string}   id       Server-assigned client ID for future communications
   * @param {boolean}  active   Whether the client is active
  **/
  /**
   * Triggered when the server is closed
   * @callback OnClose
   * @memberof libframesocket
  **/

  /**
   * Socket server for a specific channel.
   * @class Server
   * @memberof libframesocket
   * @param {string} channel
   * @member {libframesocket.OnClient}          onclient  Closure to call when a client connects
   * @member {libframesocket.OnClientMessage}   onmessage Closure to call when a client sends a message
   * @member {libframesocket.OnClose}           onclose   Closure to call when server is closed
  **/
  function Server(channel) {
    var
      self = this,
      readyState = STATE_CONNECTING,
      clients = {},
      portIDs = [],
      ports = {}; // key: uuid, value: MessagePort

    function getNextAvailableSequentialID() {
      var result = portIDs.length;
      for (var i = 0; i < result;i++) {
        if (portIDs[i] !== i) {
          result = i;
        }
      }
      portIDs[result]=result;
      return result;
    }
    function deletePort(id) {
      delete ports[id];
      portIDs.splice(portIDs.indexOf(parseInt(id)),1);
    }
    function onclient(client) {
      var
        id = client.id,
        active = client[STR_ACTIVE];
      if (active) {
        clients[id] = client;
      } else {
        delete clients[id];
      }
      call(self, STR_ONCLIENT, id, active, client.args);
    }

    function targetProxySend(payload, async) {
      return send(payload, this.id, async);
    }

    function onclientmessage(evt) {
      var
        port = this,
        id = port.id,
        responsePort = (evt.ports||[])[0],
        client = clients[id],
        evtData = evt.data,
        type = evtData.type;

      if (!client) {
        client = {};
      }
      if (type === STR_MESSAGE) {
        var targetProxy = JSON.parse(JSON.stringify(client));
        targetProxy.send = targetProxySend;

        var thisEvent = RO({}, {
          data:   evtData.data,
          from:   port.id,
          target: targetProxy,
          type:   type
        });
        // Allow for a response if required
        var reply = responsePort? function(response) {
          post(responsePort, response);
        }: noop;

        call(self, STR_ONMESSAGE, thisEvent, reply)
      } else if (type === STR_FIN) {
          client[STR_ACTIVE] = false;
          var clientPort = ports[id];
          if (clientPort) {
            call(clientPort, STR_CLOSE);
            deletePort(id);
          }
          if (responsePort) {
            post(responsePort, PAYLOAD_FIN);
          }
          // This is the case where a client disconnects while a server is closing
          if (client.id == null) {
            client.id = id;
          }
          onclient(client);
      }
    }
    function onwindowmessage(evt) {
      if (evt.data && (typeof evt.data === 'object')) {
        var
          evtData = evt.data,
          port = evt.ports? evt.ports[0]: null;
        if (port && evtData.type === STR_FRAMESOCKET && evtData.s === STR_SYN && evtData.c === channel) {
          port.id = ''+getNextAvailableSequentialID(); // Ensure we are a string
          port.req = Date.now();
          port[STR_ONMESSAGE] = onclientmessage;
          port.args = evtData.a;

          ports[port.id] = port;
          var portResponseTimeout = setTimeout(function() {
            delete ports[port.id];
          }, 1000);

          postAsync(port, {type:STR_SYN_ACK,id:port.id}, function(evt) {
            var msg = evt.data;
            if (msg === STR_SYN_ACK) {
              clearTimeout(portResponseTimeout);
              var client = {
                active  : true,
                args    : port.args,
                id      : port.id,
              };
              delete port.args;
              evt.ports[0].postMessage(STR_SYN_ACK);
              onclient(client);
            }
            // this refers to the MessagePort created
            // by postAsync
            call(this, STR_CLOSE);
          });
        }
      }
    }

    function onclose() {
      clients = {};
      for (var k in ports) {
        call(ports[k], STR_CLOSE);
        deletePort(k);
      }
      ports = {};
      readyState = STATE_CLOSED;
      call(self, STR_ONCLOSE);
      neuter(self);
    }

    /**
     * Closes the server, and notify clients
     * calls 'onclose' once closed
    **/
    function close() {
      if (readyState < STATE_CLOSING) {
        readyState = STATE_CLOSING;
        for (var k in ports) {
          // Fire and forget
          post(ports[k], PAYLOAD_FIN);
        }

        unhookWindowEvent(STR_MESSAGE, onwindowmessage);
        unhookWindowEvent(STR_UNLOAD, close);
        setTimeout(onclose);
      }
    }
    /**
     * Sends a payload to a specific client,
     * with the ability to handle a response.
     * @param {object}  payload   Payload to send
     * @param {string}  clientID  Client who will receive the message.
     * @param {closure} async     Closure to call upon response.
    **/
    function send(payload, clientID, async) {
      var
        client = clients[clientID],
        port = ports[clientID];
      if (client && client[STR_ACTIVE] && port) {
        sendMessage(port, payload, async, self);
      }
    }

    hookWindowEvent(STR_MESSAGE, onwindowmessage);
    hookWindowEvent(STR_UNLOAD, close);

    ObjectDefineProperty(
      RO(self, {
        send:     send,
        close:    close,
        url:      channel,
        channel:  channel,
        isClientActive: function(id) {
          var client = clients[id];
          return !!client && client[STR_ACTIVE];
        }
      }),
      'readyState',
      {
        get: function() {return readyState;}
      }
    );

    setTimeout(function onopen() {
      readyState = STATE_OPEN;
      call(self, STR_ONOPEN);
    });
  }

  RO(Server.prototype, STATE_HASH);

  function Socket(url, opt_protocols, opt_options) {
    if (url == null) {
      throw new Error('url is null');
    }
    var
      self = this,
      serverPort,
      unloading = false,
      split = url.split('?'),
      channel = split[0],
      args = split[1],
      options = opt_options || {},
      readyState = STATE_CONNECTING,
      onopenTimeoutHandle;

    function onerror(e) {
      close();
      call(self, STR_ONERROR, e);
      neuter(self);
    }

    function onopenTimeout() {
      onerror({why: 'timed out'});
    }

    function onclose() {
      unhookWindowEvent(STR_UNLOAD, close);
      readyState = STATE_CLOSED;
      if (serverPort) {
        call(serverPort, STR_CLOSE);
        serverPort = null;
      }
      call(self, STR_ONCLOSE);
    }
    function close() {
      if (readyState < STATE_CLOSING) {
        readyState = STATE_CLOSING;
        onopenTimeoutHandle = clearTimeout(onopenTimeoutHandle);
        var response = makeMessageChannel(onclose);
        if (serverPort) {
          // TODO: timeout
          post(serverPort, PAYLOAD_FIN, [response.port2]);
          if (unloading) {
            onclose();
          }
        } else {
          // Connecting state. Bypass
          // the STR_FIN dance and notify client
          setTimeout(onclose);
        }
      }
    }

    function send(payload, async) {
      if (readyState === STATE_OPEN) {
        sendMessage(serverPort, payload, async, self);
      }
    }

    function handleServerMessage(evt) {
      var
        evtPort = this,
        type = evt.data.type,
        responsePort = (evt.ports||[])[0];

      if (type === STR_FIN) {
        if (readyState === STATE_CONNECTING) {
          onerror({why: 'Server gone'});
        } else {
          if (serverPort) {
            call(serverPort, STR_CLOSE);
            serverPort = null;
          }
          close();
        }
      }
      else if (type === STR_SYN_ACK) {
        if (serverPort || (readyState !== STATE_CONNECTING)) {
          post(evtPort, STR_FIN);
        } else {
          serverPort = evtPort;
          RO(self, {serverid: evt.data.id});
          postAsync(responsePort, STR_SYN_ACK, function() {
            onopenTimeoutHandle = clearTimeout(onopenTimeoutHandle);
            readyState = STATE_OPEN;
            call(self, STR_ONOPEN);
          });
          hookWindowEvent(STR_UNLOAD, function() {
            unloading = true;
            close();
          });
        }
      }
      else if (type === STR_MESSAGE) {
        if (readyState === STATE_OPEN) {
          call(self, STR_ONMESSAGE, evt.data, function(payload) {
            if (responsePort) {
              post(responsePort, payload);
            }
          });
        }
      }
      else {
        logError('unhandled message', type);
      }
    }

    function pingPotentialHost(target) {
      post(target, {
        type: STR_FRAMESOCKET,
        s: STR_SYN,
        c: channel,
        a: args
      }, '*', [makeMessageChannel(function(evt) {
        handleServerMessage.call(this, evt);
      }).port2]);
    }

    function findServerChildren(root) {
      var
        frames = root.frames,
        i=0;
      for (; i < frames.length; i++) {
        pingPotentialHost(frames[i]);
        findServerChildren(frames[i]);
      }
    }

    // TODO: This algorithm is breadth-first
    // User might want to privilege depth-first
    // Most likely scenario
    function findServer() {
      var
        depth = 0,
        maxDepth = options.maxDepth;
      if (readyState === STATE_CONNECTING) {
        var
          prev,
          curr = context,
          fsc = options.children? findServerChildren: noop;
        while ( curr && curr !== prev ) {
          depth++;
          pingPotentialHost(prev = curr);
          try {
            fsc(curr);
          } catch(e) {
            // In a CORS scenario, we will be able to test our sibling,
            // but will throw an error when iterating its children.
            // Bail out silently
          }
          try {
            curr = ((maxDepth == null) || (++depth < maxDepth))? prev.parent: prev;
          } catch(e) {
            // In a CORS scenario, we can access the first window
            // outside our domain. Attempting to access its parent
            // throws a security exception - bail out silently.
            return;
          }
        }
      }
    }
    var
      timeout_ = parseInt(options.timeout),
      timeout = isNaN(timeout_)? connectTimeout: Math.max(timeout_, MIN_CONNECT_TIMEOUT);

    onopenTimeoutHandle = setTimeout(onopenTimeout, timeout);
    setTimeout(findServer);

    ObjectDefineProperty(
      RO(self, {
        send: send,
        close: close,
        url: url,
        channel: channel,
        args: args,
      }),
      'readyState', {
        get: function() {return readyState;}
      }
    );
  }

  RO(Socket.prototype, STATE_HASH);

  function make(klass) {
    return RO(function(a,b,c) {
      return new klass(a,b,c);
    }, STATE_HASH);
  }

  RO(context, {libframesocket: RO(ObjectDefineProperty({}, 'timeout', {
      get: function() {
        return connectTimeout;
      }, set: function(to) {
        to = parseInt(to);
        if (!isNaN(to) && to > MIN_CONNECT_TIMEOUT) {
          connectTimeout = to;
        }
      }
    }), {
      version: VERSION,
      Server: make(Server),
      Socket: make(Socket)
    })
  });
})(this);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

(function(window) {
  if (!window.libpubsub) {
    return;
  }
  /**
   * Provides services related to publish/subscribe
   * @file libpubsub.js
  **/
  /**
   * Provides services related to publish/subscribe
   * @namespace libpubsub
   * @requires libframesocket
  **/
  var
    libpubsub = window.libpubsub,
    libframesocket = window.libframesocket;

  function RO(who, what) {
    for (var name in what) {
      Object.defineProperty(who, name, {
        enumerable: true,
        value: what[name]
      });
    }
    return who;
  }

  function FSClient(exchange, args) {
    exchange = exchange || libpubsub.defaultExchange;
    var frameSocketURL = exchange;
    if (args != null) {
      frameSocketURL = exchange + '?' + Object.keys(args).map(function(k) {
        return k+'='+args[k];
      }).join('&');
    }
    return new libpubsub.Client(exchange, new libframesocket.Socket(frameSocketURL));
  }

  function FSRouter(downstream, upstream, wsURL) {
    downstream = downstream || libpubsub.defaultExchange;
    var downstreamServer = new libframesocket.Server(downstream);
    var makeUpstream = upstream;
    return new libpubsub.Router(downstreamServer, makeUpstream, wsURL);
  }

  function FSRoutedClient(exchange, wsURL) {
    var router = new FSRouter(exchange, null, wsURL);
    var client = new FSClient(exchange);
    client.router = router;
    return client;
  }

  RO(libpubsub, {
    FSClient: FSClient,
    FSRouter: FSRouter,
    FSRoutedClient: FSRoutedClient
  });
})(window);

/*
 * js_channel is a very lightweight abstraction on top of
 * postMessage which defines message formats and semantics
 * to support interactions more rich than just message passing
 * js_channel supports:
 *  + query/response - traditional rpc
 *  + query/update/response - incremental async return of results
 *    to a query
 *  + notifications - fire and forget
 *  + error handling
 *
 * js_channel is based heavily on json-rpc, but is focused at the
 * problem of inter-iframe RPC.
 *
 * Message types:
 *  There are 5 types of messages that can flow over this channel,
 *  and you may determine what type of message an object is by
 *  examining its parameters:
 *  1. Requests
 *    + integer id
 *    + string method
 *    + (optional) any params
 *  2. Callback Invocations (or just "Callbacks")
 *    + integer id
 *    + string callback
 *    + (optional) params
 *  3. Error Responses (or just "Errors)
 *    + integer id
 *    + string error
 *    + (optional) string message
 *  4. Responses
 *    + integer id
 *    + (optional) any result
 *  5. Notifications
 *    + string method
 *    + (optional) any params
 */

;var Channel = (function() {
    "use strict";

    // current transaction id, start out at a random *odd* number between 1 and a million
    // There is one current transaction counter id per page, and it's shared between
    // channel instances.  That means of all messages posted from a single javascript
    // evaluation context, we'll never have two with the same id.
    var s_curTranId = Math.floor(Math.random()*1000001);

    // no two bound channels in the same javascript evaluation context may have the same origin, scope, and window.
    // futher if two bound channels have the same window and scope, they may not have *overlapping* origins
    // (either one or both support '*').  This restriction allows a single onMessage handler to efficiently
    // route messages based on origin and scope.  The s_boundChans maps origins to scopes, to message
    // handlers.  Request and Notification messages are routed using this table.
    // Finally, channels are inserted into this table when built, and removed when destroyed.
    var s_boundChans = { };

    // add a channel to s_boundChans, throwing if a dup exists
    function s_addBoundChan(win, origin, scope, handler) {
        function hasWin(arr) {
            for (var i = 0; i < arr.length; i++) if (arr[i].win === win) return true;
            return false;
        }

        // does she exist?
        var exists = false;


        if (origin === '*') {
            // we must check all other origins, sadly.
            for (var k in s_boundChans) {
                if (!s_boundChans.hasOwnProperty(k)) continue;
                if (k === '*') continue;
                if (typeof s_boundChans[k][scope] === 'object') {
                    exists = hasWin(s_boundChans[k][scope]);
                    if (exists) break;
                }
            }
        } else {
            // we must check only '*'
            if ((s_boundChans['*'] && s_boundChans['*'][scope])) {
                exists = hasWin(s_boundChans['*'][scope]);
            }
            if (!exists && s_boundChans[origin] && s_boundChans[origin][scope])
            {
                exists = hasWin(s_boundChans[origin][scope]);
            }
        }
        if (exists) throw "A channel is already bound to the same window which overlaps with origin '"+ origin +"' and has scope '"+scope+"'";

        if (typeof s_boundChans[origin] != 'object') s_boundChans[origin] = { };
        if (typeof s_boundChans[origin][scope] != 'object') s_boundChans[origin][scope] = [ ];
        s_boundChans[origin][scope].push({win: win, handler: handler});
    }

    function s_removeBoundChan(win, origin, scope) {
        var arr = s_boundChans[origin][scope];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].win === win) {
                arr.splice(i,1);
            }
        }
        if (s_boundChans[origin][scope].length === 0) {
            delete s_boundChans[origin][scope];
        }
    }

    function s_isArray(obj) {
        if (Array.isArray) return Array.isArray(obj);
        else {
            return (obj.constructor.toString().indexOf("Array") != -1);
        }
    }

    // No two outstanding outbound messages may have the same id, period.  Given that, a single table
    // mapping "transaction ids" to message handlers, allows efficient routing of Callback, Error, and
    // Response messages.  Entries are added to this table when requests are sent, and removed when
    // responses are received.
    var s_transIds = { };

    // class singleton onMessage handler
    // this function is registered once and all incoming messages route through here.  This
    // arrangement allows certain efficiencies, message data is only parsed once and dispatch
    // is more efficient, especially for large numbers of simultaneous channels.
    var s_onMessage = function(e) {
        try {
          var m = JSON.parse(e.data);
          if (typeof m !== 'object' || m === null) throw "malformed";
        } catch(e) {
          // just ignore any posted messages that do not consist of valid JSON
          return;
        }

        var w = e.source;
        var o = e.origin;
        var s, i, meth;

        if (typeof m.method === 'string') {
            var ar = m.method.split('::');
            if (ar.length == 2) {
                s = ar[0];
                meth = ar[1];
            } else {
                meth = m.method;
            }
        }

        if (typeof m.id !== 'undefined') i = m.id;

        // w is message source window
        // o is message origin
        // m is parsed message
        // s is message scope
        // i is message id (or undefined)
        // meth is unscoped method name
        // ^^ based on these factors we can route the message

        // if it has a method it's either a notification or a request,
        // route using s_boundChans
        if (typeof meth === 'string') {
            var delivered = false;
            if (s_boundChans[o] && s_boundChans[o][s]) {
                for (var j = 0; j < s_boundChans[o][s].length; j++) {
                    if (s_boundChans[o][s][j].win === w) {
                        s_boundChans[o][s][j].handler(o, meth, m);
                        delivered = true;
                        break;
                    }
                }
            }

            if (!delivered && s_boundChans['*'] && s_boundChans['*'][s]) {
                for (var j = 0; j < s_boundChans['*'][s].length; j++) {
                    if (s_boundChans['*'][s][j].win === w) {
                        s_boundChans['*'][s][j].handler(o, meth, m);
                        break;
                    }
                }
            }
        }
        // otherwise it must have an id (or be poorly formed
        else if (typeof i != 'undefined') {
            if (s_transIds[i]) s_transIds[i](o, meth, m);
        }
    };

    // Setup postMessage event listeners
    if (window.addEventListener) window.addEventListener('message', s_onMessage, false);
    else if(window.attachEvent) window.attachEvent('onmessage', s_onMessage);

    /* a messaging channel is constructed from a window and an origin.
     * the channel will assert that all messages received over the
     * channel match the origin
     *
     * Arguments to Channel.build(cfg):
     *
     *   cfg.window - the remote window with which we'll communicate
     *   cfg.origin - the expected origin of the remote window, may be '*'
     *                which matches any origin
     *   cfg.scope  - the 'scope' of messages.  a scope string that is
     *                prepended to message names.  local and remote endpoints
     *                of a single channel must agree upon scope. Scope may
     *                not contain double colons ('::').
     *   cfg.debugOutput - A boolean value.  If true and window.console.log is
     *                a function, then debug strings will be emitted to that
     *                function.
     *   cfg.debugOutput - A boolean value.  If true and window.console.log is
     *                a function, then debug strings will be emitted to that
     *                function.
     *   cfg.postMessageObserver - A function that will be passed two arguments,
     *                an origin and a message.  It will be passed these immediately
     *                before messages are posted.
     *   cfg.gotMessageObserver - A function that will be passed two arguments,
     *                an origin and a message.  It will be passed these arguments
     *                immediately after they pass scope and origin checks, but before
     *                they are processed.
     *   cfg.onReady - A function that will be invoked when a channel becomes "ready",
     *                this occurs once both sides of the channel have been
     *                instantiated and an application level handshake is exchanged.
     *                the onReady function will be passed a single argument which is
     *                the channel object that was returned from build().
     */
    return {
        build: function(cfg) {
            var debug = function(m) {
                if (cfg.debugOutput && window.console && window.console.log) {
                    // try to stringify, if it doesn't work we'll let javascript's built in toString do its magic
                    try { if (typeof m !== 'string') m = JSON.stringify(m); } catch(e) { }
                    console.log("["+chanId+"] " + m);
                }
            };

            /* browser capabilities check */
            if (!window.postMessage) throw("jschannel cannot run this browser, no postMessage");
            if (!window.JSON || !window.JSON.stringify || ! window.JSON.parse) {
                throw("jschannel cannot run this browser, no JSON parsing/serialization");
            }

            /* basic argument validation */
            if (typeof cfg != 'object') throw("Channel build invoked without a proper object argument");

            if (!cfg.window || !cfg.window.postMessage) throw("Channel.build() called without a valid window argument");

            /* we'd have to do a little more work to be able to run multiple channels that intercommunicate the same
             * window...  Not sure if we care to support that */
            if (window === cfg.window) throw("target window is same as present window -- not allowed");

            // let's require that the client specify an origin.  if we just assume '*' we'll be
            // propagating unsafe practices.  that would be lame.
            var validOrigin = false;
            if (typeof cfg.origin === 'string') {
                var oMatch;
                if (cfg.origin === "*") validOrigin = true;
                // allow valid domains under http and https.  Also, trim paths off otherwise valid origins.
                else if (null !== (oMatch = cfg.origin.match(/^https?:\/\/(?:[-a-zA-Z0-9_\.])+(?::\d+)?/))) {
                    cfg.origin = oMatch[0].toLowerCase();
                    validOrigin = true;
                }
            }

            if (!validOrigin) throw ("Channel.build() called with an invalid origin");

            if (typeof cfg.scope !== 'undefined') {
                if (typeof cfg.scope !== 'string') throw 'scope, when specified, must be a string';
                if (cfg.scope.split('::').length > 1) throw "scope may not contain double colons: '::'";
            }

            /* private variables */
            // generate a random and psuedo unique id for this channel
            var chanId = (function () {
                var text = "";
                var alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                for(var i=0; i < 5; i++) text += alpha.charAt(Math.floor(Math.random() * alpha.length));
                return text;
            })();

            // registrations: mapping method names to call objects
            var regTbl = { };
            // current oustanding sent requests
            var outTbl = { };
            // current oustanding received requests
            var inTbl = { };
            // are we ready yet?  when false we will block outbound messages.
            var ready = false;
            var pendingQueue = [ ];

            var createTransaction = function(id,origin,callbacks) {
                var shouldDelayReturn = false;
                var completed = false;

                return {
                    origin: origin,
                    invoke: function(cbName, v) {
                        // verify in table
                        if (!inTbl[id]) throw "attempting to invoke a callback of a nonexistent transaction: " + id;
                        // verify that the callback name is valid
                        var valid = false;
                        for (var i = 0; i < callbacks.length; i++) if (cbName === callbacks[i]) { valid = true; break; }
                        if (!valid) throw "request supports no such callback '" + cbName + "'";

                        // send callback invocation
                        postMessage({ id: id, callback: cbName, params: v});
                    },
                    error: function(error, message) {
                        completed = true;
                        // verify in table
                        if (!inTbl[id]) throw "error called for nonexistent message: " + id;

                        // remove transaction from table
                        delete inTbl[id];

                        // send error
                        postMessage({ id: id, error: error, message: message });
                    },
                    complete: function(v) {
                        completed = true;
                        // verify in table
                        if (!inTbl[id]) throw "complete called for nonexistent message: " + id;
                        // remove transaction from table
                        delete inTbl[id];
                        // send complete
                        postMessage({ id: id, result: v });
                    },
                    delayReturn: function(delay) {
                        if (typeof delay === 'boolean') {
                            shouldDelayReturn = (delay === true);
                        }
                        return shouldDelayReturn;
                    },
                    completed: function() {
                        return completed;
                    }
                };
            };

            var setTransactionTimeout = function(transId, timeout, method) {
              return window.setTimeout(function() {
                if (outTbl[transId]) {
                  // XXX: what if client code raises an exception here?
                  var msg = "timeout (" + timeout + "ms) exceeded on method '" + method + "'";
                  (1,outTbl[transId].error)("timeout_error", msg);
                  delete outTbl[transId];
                  delete s_transIds[transId];
                }
              }, timeout);
            };

            var onMessage = function(origin, method, m) {
                // if an observer was specified at allocation time, invoke it
                if (typeof cfg.gotMessageObserver === 'function') {
                    // pass observer a clone of the object so that our
                    // manipulations are not visible (i.e. method unscoping).
                    // This is not particularly efficient, but then we expect
                    // that message observers are primarily for debugging anyway.
                    try {
                        cfg.gotMessageObserver(origin, m);
                    } catch (e) {
                        debug("gotMessageObserver() raised an exception: " + e.toString());
                    }
                }

                // now, what type of message is this?
                if (m.id && method) {
                    // a request!  do we have a registered handler for this request?
                    if (regTbl[method]) {
                        var trans = createTransaction(m.id, origin, m.callbacks ? m.callbacks : [ ]);
                        inTbl[m.id] = { };
                        try {
                            // callback handling.  we'll magically create functions inside the parameter list for each
                            // callback
                            if (m.callbacks && s_isArray(m.callbacks) && m.callbacks.length > 0) {
                                for (var i = 0; i < m.callbacks.length; i++) {
                                    var path = m.callbacks[i];
                                    var obj = m.params;
                                    var pathItems = path.split('/');
                                    for (var j = 0; j < pathItems.length - 1; j++) {
                                        var cp = pathItems[j];
                                        if (typeof obj[cp] !== 'object') obj[cp] = { };
                                        obj = obj[cp];
                                    }
                                    obj[pathItems[pathItems.length - 1]] = (function() {
                                        var cbName = path;
                                        return function(params) {
                                            return trans.invoke(cbName, params);
                                        };
                                    })();
                                }
                            }
                            var resp = regTbl[method](trans, m.params);
                            if (!trans.delayReturn() && !trans.completed()) trans.complete(resp);
                        } catch(e) {
                            // automagic handling of exceptions:
                            var error = "runtime_error";
                            var message = null;
                            // * if it's a string then it gets an error code of 'runtime_error' and string is the message
                            if (typeof e === 'string') {
                                message = e;
                            } else if (typeof e === 'object') {
                                // either an array or an object
                                // * if it's an array of length two, then  array[0] is the code, array[1] is the error message
                                if (e && s_isArray(e) && e.length == 2) {
                                    error = e[0];
                                    message = e[1];
                                }
                                // * if it's an object then we'll look form error and message parameters
                                else if (typeof e.error === 'string') {
                                    error = e.error;
                                    if (!e.message) message = "";
                                    else if (typeof e.message === 'string') message = e.message;
                                    else e = e.message; // let the stringify/toString message give us a reasonable verbose error string
                                }
                            }

                            // message is *still* null, let's try harder
                            if (message === null) {
                                try {
                                    message = JSON.stringify(e);
                                    /* On MSIE8, this can result in 'out of memory', which
                                     * leaves message undefined. */
                                    if (typeof(message) == 'undefined')
                                      message = e.toString();
                                } catch (e2) {
                                    message = e.toString();
                                }
                            }

                            trans.error(error,message);
                        }
                    }
                } else if (m.id && m.callback) {
                    if (!outTbl[m.id] ||!outTbl[m.id].callbacks || !outTbl[m.id].callbacks[m.callback])
                    {
                        debug("ignoring invalid callback, id:"+m.id+ " (" + m.callback +")");
                    } else {
                        // XXX: what if client code raises an exception here?
                        outTbl[m.id].callbacks[m.callback](m.params);
                    }
                } else if (m.id) {
                    if (!outTbl[m.id]) {
                        debug("ignoring invalid response: " + m.id);
                    } else {
                        // XXX: what if client code raises an exception here?
                        if (m.error) {
                            (1,outTbl[m.id].error)(m.error, m.message);
                        } else {
                            if (m.result !== undefined) (1,outTbl[m.id].success)(m.result);
                            else (1,outTbl[m.id].success)();
                        }
                        delete outTbl[m.id];
                        delete s_transIds[m.id];
                    }
                } else if (method) {
                    // tis a notification.
                    if (regTbl[method]) {
                        // yep, there's a handler for that.
                        // transaction has only origin for notifications.
                        regTbl[method]({ origin: origin }, m.params);
                        // if the client throws, we'll just let it bubble out
                        // what can we do?  Also, here we'll ignore return values
                    }
                }
            };

            // now register our bound channel for msg routing
            s_addBoundChan(cfg.window, cfg.origin, ((typeof cfg.scope === 'string') ? cfg.scope : ''), onMessage);

            // scope method names based on cfg.scope specified when the Channel was instantiated
            var scopeMethod = function(m) {
                if (typeof cfg.scope === 'string' && cfg.scope.length) m = [cfg.scope, m].join("::");
                return m;
            };

            // a small wrapper around postmessage whose primary function is to handle the
            // case that clients start sending messages before the other end is "ready"
            var postMessage = function(msg, force) {
                if (!msg) throw "postMessage called with null message";

                msg.type = 'jschannel';

                // delay posting if we're not ready yet.
                var verb = (ready ? "post  " : "queue ");
                debug(verb + " message: " + JSON.stringify(msg));
                if (!force && !ready) {
                    pendingQueue.push(msg);
                } else {
                    if (typeof cfg.postMessageObserver === 'function') {
                        try {
                            cfg.postMessageObserver(cfg.origin, msg);
                        } catch (e) {
                            debug("postMessageObserver() raised an exception: " + e.toString());
                        }
                    }

                    cfg.window.postMessage(JSON.stringify(msg), cfg.origin);
                }
            };

            var onReady = function(trans, type) {
                debug('ready msg received');
                if (ready) throw "received ready message while in ready state.  help!";

                if (type === 'ping') {
                    chanId += '-R';
                } else {
                    chanId += '-L';
                }

                obj.unbind('__ready'); // now this handler isn't needed any more.
                ready = true;
                debug('ready msg accepted.');

                if (type === 'ping') {
                    obj.notify({ method: '__ready', params: 'pong' });
                }

                // flush queue
                while (pendingQueue.length) {
                    postMessage(pendingQueue.pop());
                }

                // invoke onReady observer if provided
                if (typeof cfg.onReady === 'function') cfg.onReady(obj);
            };

            var obj = {
                // tries to unbind a bound message handler.  returns false if not possible
                unbind: function (method) {
                    if (regTbl[method]) {
                        if (!(delete regTbl[method])) throw ("can't delete method: " + method);
                        return true;
                    }
                    return false;
                },
                bind: function (method, cb) {
                    if (!method || typeof method !== 'string') throw "'method' argument to bind must be string";
                    if (!cb || typeof cb !== 'function') throw "callback missing from bind params";

                    if (regTbl[method]) throw "method '"+method+"' is already bound!";
                    regTbl[method] = cb;
                    return this;
                },
                call: function(m) {
                    if (!m) throw 'missing arguments to call function';
                    if (!m.method || typeof m.method !== 'string') throw "'method' argument to call must be string";
                    if (!m.success || typeof m.success !== 'function') throw "'success' callback missing from call";

                    // now it's time to support the 'callback' feature of jschannel.  We'll traverse the argument
                    // object and pick out all of the functions that were passed as arguments.
                    var callbacks = { };
                    var callbackNames = [ ];
                    var seen = [ ];

                    var pruneFunctions = function (path, obj) {
                        if (seen.indexOf(obj) >= 0) {
                            throw "params cannot be a recursive data structure"
                        }
                        seen.push(obj);

                        if (typeof obj === 'object') {
                            for (var k in obj) {
                                if (!obj.hasOwnProperty(k)) continue;
                                var np = path + (path.length ? '/' : '') + k;
                                if (typeof obj[k] === 'function') {
                                    callbacks[np] = obj[k];
                                    callbackNames.push(np);
                                    delete obj[k];
                                } else if (typeof obj[k] === 'object') {
                                    pruneFunctions(np, obj[k]);
                                }
                            }
                        }
                    };
                    pruneFunctions("", m.params);

                    // build a 'request' message and send it
                    var msg = { id: s_curTranId, method: scopeMethod(m.method), params: m.params };
                    if (callbackNames.length) msg.callbacks = callbackNames;

                    if (m.timeout)
                      // XXX: This function returns a timeout ID, but we don't do anything with it.
                      // We might want to keep track of it so we can cancel it using clearTimeout()
                      // when the transaction completes.
                      setTransactionTimeout(s_curTranId, m.timeout, scopeMethod(m.method));

                    // insert into the transaction table
                    outTbl[s_curTranId] = { callbacks: callbacks, error: m.error, success: m.success };
                    s_transIds[s_curTranId] = onMessage;

                    // increment current id
                    s_curTranId++;

                    postMessage(msg);
                },
                notify: function(m) {
                    if (!m) throw 'missing arguments to notify function';
                    if (!m.method || typeof m.method !== 'string') throw "'method' argument to notify must be string";

                    // no need to go into any transaction table
                    postMessage({ method: scopeMethod(m.method), params: m.params });
                },
                destroy: function () {
                    s_removeBoundChan(cfg.window, cfg.origin, ((typeof cfg.scope === 'string') ? cfg.scope : ''));
                    if (window.removeEventListener) window.removeEventListener('message', onMessage, false);
                    else if(window.detachEvent) window.detachEvent('onmessage', onMessage);
                    ready = false;
                    regTbl = { };
                    inTbl = { };
                    outTbl = { };
                    cfg.origin = null;
                    pendingQueue = [ ];
                    debug("channel destroyed");
                    chanId = "";
                }
            };

            obj.bind('__ready', onReady);
            setTimeout(function() {
                postMessage({ method: scopeMethod('__ready'), params: "ping" }, true);
            }, 0);

            return obj;
        }
    };
})();

/*
 * Initiate a JSON RPC request to the scheduler.
 * iface:   json interface to query (/CM/<iface>.json on the HTTP server).
 * method:  RPC method name.
 * params:  RPC parameters.
 * asyncCb: Mandatory. The call returns undefined, and asyncCb is called
 *          on request completion, with the response as parameter.
 */
var jsonRpcRemote = (function() {
  // PIP URL: /pip//http/10.2.1.109:4980/CM/json.cgi
  // PIP With Proxy URL: /pip/proxy/http/10.2.1.168:3128/http/10.2.1.110:4980/CM/json.cgi
  var pip = window.location.pathname.match(/^(\/pip\/(proxy\/https?\/[^\/]+)?\/https?\/[^\/]+)\//);
  pip = pip === null ? '' : pip[1];
  var JsonRpc = {
    requestCount: 0,
    version:     "2.0",
    server:      pip + "/JSON/"
  };
  var xhr_timeout = 30000; // JsonRpc AJAX request timeout (s).

  function processResponse(xhr, requestId) {
    var response;
    if(xhr.status == 200) {
      try {
        response = JSON.parse(xhr.responseText);
      } catch(ex) {
        response = {
          jsonrpc: JsonRpc.version,
          id:      requestId,
          error: {
            code:    -32200, // Non-standard: receiver error.
            message: "JSON error " + ex.code,
            data:    ex.message
          }
        };
      }
    } else {
      response = {
        jsonrpc: JsonRpc.version,
        id:      requestId,
        error: {
          code:    -32300, // Transport error.
          message: "http error " + xhr.status,
          data:    xhr.statusText
        }
      };
    }
    return response;
  }

  return function jsonRpcRemote(origin, iface, method, params, asyncCb) {
   if (!asyncCb) {
      throw "JsonRpc synchronous mode is deprecated";
    }
    var xhr = new XMLHttpRequest;
    JsonRpc.requestCount++;
    var requestId = JsonRpc.requestCount; // For the closure.
    var request = JSON.stringify({
      jsonrpc: JsonRpc.version,
      id:      requestId,
      method:  method,
      params:  params
    });
    origin = origin || '';
    xhr.open('POST', origin + JsonRpc.server + iface + '.json', !!asyncCb);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept',       'application/json');
    if (origin != '') {
      xhr.withCredentials = true;
    }
    var to = setTimeout(function() {
      xhr.abort();
    }, xhr_timeout);
    xhr.onreadystatechange = function() {
      if (xhr.readyState == 4) {
        clearTimeout(to);
        asyncCb(processResponse(xhr, requestId));
      }
    }
    xhr.send(request);
    return undefined;
  };
})();

var jsonRpc = (function() {
  return function jsonRpc(iface, method, params, asyncCb) {
    return jsonRpcRemote(null, iface, method, params, asyncCb);
  };
})();

/*
 * Get an instance of the desired interface (player, properties, anydb, ...).
 *   var player = avInterface('player');
 *   player.start();
 */
var avInterface = (function() {
  /*
   * Base interface.
   */
  var baseInterface = function(iname, origin) {
    this.iface = iname;
    this.origin = origin; // Undefined for localhost
  };

  /* Set error state depending on return code */
  baseInterface.prototype.jsonReturn = function(r) {
    if (r.error !== undefined) {
      this.error = r.error;
      return undefined;
    }
    this.error = undefined;
    return r.result;
  };

  /*
   * Wrapper for interface functions.
   * It calls the RPC method and return the result in case of success
   * or set this.error and return undefined.
   */
  baseInterface.prototype.jsonProcess = function(name, params, asyncCb) {
    if (!asyncCb) {
      throw "JsonRpc synchronous mode is deprecated";
    }
    var myself = this; // For the closure.
    return jsonRpcRemote(this.origin, this.iface, name, params, function (r) { asyncCb(myself, myself.jsonReturn(r)); });
  };

  baseInterface.prototype.apiVersion = function(asyncCb) {
    return this.jsonProcess('apiVersion', undefined, asyncCb);
  };

  /* Authentication
   * user:     username (string)
   * passwd:   password (string)
   * remember: authentication will expires after 1h when false (0) and 1 week when true (1). Integer, default: 0.
   * On error:
   *   - 'permission denied' (-16009): authentication failed
   * For any other calls, when 'authentication required' (-16010) is returned, login() must be issued again.
   * When the user is authenticated, but not allow a particular call, 'permission denied' (-16009) is returned.
   */
  baseInterface.prototype.login = function(user, passwd, remember, asyncCb) {
    var myself = this; // For the closure.
    return jsonRpcRemote(this.origin, 'Login', 'login', { user: user, passwd: passwd, remember: remember }, function (r) { asyncCb(myself, myself.jsonReturn(r)); });
  };

  baseInterface.prototype.logout = function(asyncCb) {
    var myself = this; // For the closure.
    return jsonRpcRemote(this.origin, 'Login', 'logout', null, function (r) { asyncCb(myself, myself.jsonReturn(r)); });
  };

  /*
   * AnyDB interface.
   */
  var anydbInterface = function(origin) {
    baseInterface.call(this, 'AnyDB', origin);

    /* Execute an SQL query (possibly executed multiple times; see the params argument).
     * db:    DB filename (no path, relative to the default DB directory).
     * query: query arguments as an object:
     *   type:   Query type:
     *             'select': return all rows as an array of arrays or array of values for single-value rows,
     *             'insert': return rowid of inserted row,
     *             'do':     return execute code (number of affected rows, -1 if unknown)
     *   sql:    SQL statement (only 1; use queries for multiple statements).
     *   params: Array of SQL parameters (binded to '?' marks within the sql statement).
     *           Use an array of arrays of SQL parameters to execute multiple times the same query with different arguments.
     * return data depending on 'type' (argument see above). If the query is executed multiple times, an array of data is returned
     * (one entry per execution).
     */
    this.query = function(db, query, asyncCb) {
      return this.jsonProcess('query', { db: db, query: query }, asyncCb);
    };
    /* Execute multiple SQL queries.
     * db:   DB filename (no path, relative to the default DB directory).
     * queries: array of 'query' as defined in query() above.
     * return an array of query return data (one per query), as defined in query().
     */
    this.queries = function(db, queries, asyncCb) {
      return this.jsonProcess('queries', { db: db, queries: queries }, asyncCb);
    };
    /* Execute an SQL query of type 'do'.
     * See query().
     */
    this.do = function(db, query, asyncCb) {
      return this.jsonProcess('do', { db: db, query: query }, asyncCb);
    };
    /* Execute an SQL query of type 'insert'.
     * See query().
     */
    this.insert = function(db, query, asyncCb) {
      return this.jsonProcess('insert', { db: db, query: query }, asyncCb);
    };
    /* Execute an SQL query of type 'select'.
     * See query().
     */
    this.select = function(db, query, asyncCb) {
      return this.jsonProcess('select', { db: db, query: query }, asyncCb);
    };
  };
  anydbInterface.prototype = Object.create(baseInterface.prototype);
  anydbInterface.prototype.constructor = anydbInterface;

  /*
   * Wrapper for interface function, allowing parameter lists or names parameters.
   */
  baseInterface.prototype.jsonProcessParams = function(name, arglist, args) {
    var params;
    var asyncCb;

    // args is an Argument object... not an Array: shift, pop... does not work on it.
    var len = args.length;
    if (len && typeof args[len-1] === "function") {
      len--;
      asyncCb = args[len];
    }
    if (len) {
      if (len === 1 && typeof args[0] === "object") {
        params = args[0];
      } else {
        if (len > arglist.length) {
          throw "Too many arguments to JSON method " + name + " (" + len + "/" + arglist.length + ")";
        }
        params = {};
        for (var i=0; i<len; i++) {
          params[arglist[i]] = args[i];
        }
      }
    }
    return this.jsonProcess(name, params, asyncCb);
  };

  /*****************************************************************************
   * Assets interface.
   *****************************************************************************
   * All functions accept a callback as last argument, to get the RPC result.
   * When the callback is not specified, the function will be synchronous.
   *
   * Note on JavaScript Date() mess:
   *   This interface is mainly using 2 type of dates: UTC and floating.
   *   Floating time is relative to the local timezone, whatever this timezone
   *   is (while Local time is relative to a specific timezone).
   *   In particular, a floating time may not exist in the local time during
   *   daylight changes.
   *   To convert a Floating time to a Local time, one need to attach a timezone
   *   to it (usually the local timezone). Be careful that this conversion cannot
   *   be performed for certain time during daylight changes.
   *   Converting a Local time to floating time requires to detach it from its
   *   Local timezone, eg:
   *     "2012-12-12T12:12:12-0500" => "2012-12-12T12:12:12"
   *   Floating times can be safely converted from/to UTC, especially in the
   *   epoch time format, for comparisons or computations. That is, an easy way
   *   to compare 2 floating times (or a floating time and a local time) is to
   *   convert them to UTC/epoch format.
   *
   *   JavaScript has it very own way to understand dates. Here is guidelines to
   *   process dates with this interface:
   *   - All dates specified as UTC must have the following format (milliseconds optional):
   *       YYYY-MM-DDThh:mm:ss[.mmm]Z
   *     This format can be safely used in Date().
   *     Date.prototype.toISOString() should generate this format, when corretly set as UTC.
   *   - All dates specified as Floating Time must have the following format:
   *       YYYY-MM-DDThh:mm:ss
   *     This format must be converted to "YYYY/MM/DD hh:mm:ss" for Date(). Also,
   *     be prepared to catch exceptions that could arise during daylight
   *     change corner cases.
   *
   * See also: http://dygraphs.com/date-formats.html
   */
  var assetsInterface = function(origin) {
    baseInterface.call(this, 'Assets', origin);

    /*
     * List assets currently on the player.
     * All parameters are optional.
     * Usually only one of name, ename, uid or cmid filter is used.
     * params: {
     *   name       Exact name of the asset(s).
     *   ename      Unix-like wildcard asset name (case-sensitive).
     *   uid        unique ID on this player.
     *   cmid       ID, as provided by CM (unique when a single CM is used).
     *   type       Assets type: 'content', 'playlist' or 'set'.
     *   mediatype  Media type (for contents): video, html, ...
     *   tags       {mykey:"myvalue"}, {key:"mykey",value:"myvalue"} or an array of those.
     *              ekey/evalue can be used instead of key/value to unix-like GLOB matching.
     *   withtags   true to request asset tags in the answer.
     *   limit,offset For paginated queries.
     * }
     * Return a hash of assets, with uid as key: {
     *   uid:       unique asset ID on this player
     *   type:      asset type (content, playlist or set).
     *   cmid:      CM asset ID (prefer to use uid for really unique ID on the player).
     *   mediaid:   Media ID from CM (mostly useless).
     *   mediatype: Media type (video, smil, ...)
     *   name:      Asset name
     *   file:      Filename
     *   duration:  Assets duration (can be undefined).
     *   size:      File size
     *   // Only when lifecycle data are available.
     *   lifecycle: {
     *     startdate:  ISO8601 date, floating timezone. See JS Date() mess note above.
     *     enddate:    ISO8601 date, floating timezone. See JS Date() mess note above.
     *   },
     *   // When schedule is available. Define the period within which the asset is schedule.
     *   // for detailed schedules, use getSchedules() method.
     *   schedule: {
     *     startdate:  ISO8601 date, floating timezone.
     *     enddate:    ISO8601 date, floating timezone.
     *   },
     *   // Asset tags (if provided by CM and request withtags option).
     *   tags: {
     *     <name>: {
     *       value:   Tag string when unique, array of strings otherwise.
     *                When the tag has a .json extension, returns a JSON object/array decoded from the tag value.
     *                When there are multiple values, a json array with the json documents decoded from those
     *                values is returned.
     *                In case of JSON format error, the initial value string is returned instead.
     *       private: True when this tag is private (false or not provoded otherwise).
     *     }
     *   }
     * }
     */
    this.getAssets = function(params, asyncCb) {
      return this.jsonProcess('getAssets', params, asyncCb);
    }

    /*
     * List assets from a given container (recursively within sub-containers).
     * params: {
     *   container  Hash with getAssets() parameters, or just 'uid' for the container internal ID (obtained with getAssets).
     *              Note: use of 'id' is deprecated in 4.0 and above. Use 'uid' instead.
     *   name       Exact name of the asset(s). Optional.
     *   ename      Unix-like wildcard asset name (case-sensitive). Optional.
     *   type       Assets type: 'content', 'playlist' or 'set'. Optional.
     *   mediatype  Media type (for contents): video, html, ...
     *   withtags   true to request asset tags in the answer.
     * }
     * Return an assets hash, like getAssets() above.
     */
    this.getAssetsFromContainer = function(params, asyncCb) {
      return this.jsonProcess('getAssetsFromContainer', params, asyncCb);
    }

    /*
     * Query schedules, exploded with recurrences, but not merged as playtimes.
     * params: {
     *   playerid: player ID to get playtimes for.
     *   type:     schedule type: 'data', 'kiosk' or 'sign'. Default: data.
     *   start:    ISO8601 UTC start date/time. Default: 1h ago. See JS Date() mess note above.
     *   period:   period in seconds. Default: 24h.
     * }
     * Return an array of schedule entries: {
     *   uid:        unique schedule entry (be careful: one entry can appear several times in the array in case of recurence).
     *   // fragmentid+playerid+entryid is a unique key for a given CM.
     *   fragmentid  fragment ID (from CM)
     *   playerid    Logical player id.
     *   entryid     Entry ID (within the schedule fragment file)
     *   name        Schedule name (not always set).
     *   description Schedule description (not always set either).
     *   default     True when this is a default schedule.
     *   // Instance of this schedule entry
     *   schedule: {
     *     start:    ISO8601 date, floating timezone. See JS Date() mess note above.
     *     end:      ISO8601 date, floating timezone. See JS Date() mess note above.
     *   },
     *   asset: {
     *     uid:      Asset UID.
     *     // See other asset fields in the getAssets() description.
     *   },
     *   priority: {
     *     min:      Minimal priority.
     *     max:      Maximal priority.
     *   }
     * }
     */
    this.getSchedules = function(params, asyncCb) {
      return this.jsonProcess('getSchedules', params, asyncCb);
    }

    /*
     * Query playtimes (all schedule entries merged).
     * params: {
     *   playerid: player ID to get playtimes for.
     *   type:     schedule type: 'data', 'kiosk' or 'sign'. Default: data.
     *   // Playtimes are cached, so it is a good idea to always use the same shifting time window.
     *   start:    ISO8601 UTC start date/time. Default: 1h ago. See JS Date() mess note above.
     *   period:   period in seconds. Default: 24h.
     * }
     * Return an array of playtimes: {
     *   type
     *   syncstart  Original entry start date, before playtime merge. ISO8601 date, floating timezone. See JS Date() mess note above.
     *   start      ISO8601 date, floating timezone. See JS Date() mess note above.
     *   end        ISO8601 date, floating timezone. See JS Date() mess note above.
     *   entry: {
     *     // See schedule entry description in getSchedules().
     *   }
     * }
     */
    this.getPlaytimes = function(params, asyncCb) {
      return this.jsonProcess('getPlaytimes', params, asyncCb);
    }

    /*
     * Get the current playtime.
     * params: {
     *   time:     the current UTC time (RFC3339 string, with 'Z' marker: YYYY-MM-DDThh:mm:ssZ).
     *             Must be within the playtimes time window defined with start/period.
     *   playerid: player ID to get playtimes for.
     *   type:     schedule type: 'data', 'kiosk' or 'sign'. Default: data.
     *   // Playtimes are cached, so it is a good idea to always use the same shifting time window.
     *   start:    ISO8601 UTC start date/time. Default: 1h ago. See JS Date() mess note above.
     *   period:   period in seconds. Default: 24h.
     *   default:  returns the default playtime fallback as well.
     * }
     * Return a playtime (see getPlaytimes()).
     *   If the default playtime is requested, it will be provided in the { default: <playtime> } field.
     *   The playtime may be undefined if there is none. In this case, the main playtime may be the default
     *   (check the playtime entry default flag).
     */
    this.currentPlaytime = function(params, asyncCb) {
      return this.jsonProcess('currentPlaytime', params, asyncCb);
    }

    /*
     * Get the next playtime (the playtime after the current one).
     * See currentPlaytime().
     */
    this.nextPlaytime = function(params, asyncCb) {
      return this.jsonProcess('nextPlaytime', params, asyncCb);
    }

    /* [DEPRECATED]
     * Get list of playlists on player
     * none
     * return an object: {<playlist_name>:{<playlist props>}, <playlist_name>:{<playlist_props>}, ...}
     */
    this.getPlaylistIDs = function(asyncCb) {
      return this.jsonProcess('getPlaylistIDs', {}, asyncCb);
    };
    /* [DEPRECATED]
     * Get list of videos for a specified playlist on player
     * params: name: name of playlist.
     * return an object: {<video_name>:{<video_props>}, <video_name>:{<video_props>}, ...}
     */
    this.getVideosForPlaylist = function(name, asyncCb) {
      return this.jsonProcess('getVideosForPlaylist', {name: name}, asyncCb);
    };
    /* [DEPRECATED]
     */
    this.getHTMLForPlaylist = function(name, asyncCb) {
      return this.jsonProcess('getHTMLForPlaylist', {name: name}, asyncCb);
    };
  };
  assetsInterface.prototype = Object.create(baseInterface.prototype);
  assetsInterface.prototype.constructor = assetsInterface;

  /*****************************************************************************
   * Player interface.
   *****************************************************************************
   * All functions accept a callback as last argument, to get the RPC result.
   * When the callback is not specified, the function will be synchronous.
   *
   * Most functions accept either a parameter list, or named parameters.
   * The parameter names and order are defined in comments (and as an array within the jsonProcessParams call).
   *
   * Eg for affidavit():
   *   // Synchronous:
   *   result = player.affidavit("/tmp/affidavit.txt", "2012/01/01 00:00:00", "2012/01/02 00:00:00");
   *   // Asynchronous, with parameters list:
   *   player.affidavit("/tmp/affidavit.txt", "2012/01/01 00:00:00", "2012/01/02 00:00:00", function (iface, result) {  });
   *   // with named parameters:
   *   player.affidavit({
   *     file: "/tmp/affidavit.txt",
   *     start: "2012/01/01 00:00:00",
   *     end: "2012/01/02 00:00:00"
   *   }, function (iface, result) {  });
   */
  var playerInterface = function(origin) {
    baseInterface.call(this, 'Player', origin);

    // Generate affidavit report for [start, end[ period.
    //   file (string): Generated affidavit file path.
    //   start, end (date): "YYYY/MM/DD hh:mm:ss[.mmm]" or floating seconds since epoch.
    this.affidavit = function() {
      return this.jsonProcessParams('affidavit', [ 'file', 'start', 'end' ], arguments);
    };
    // Initiate autoregistration.
    //   force (undef, 0, 1): 1=Force to send the autoregistration request, even if the local IP has not changed.
    this.autoreg = function() {
      return this.jsonProcessParams('autoreg', [ 'force' ], arguments);
    };
    // Cleanup expired entries in the assets database.
    this.cleanup = function(asyncCb) {
      return this.jsonProcess('cleanup', undefined, asyncCb);
    };
    // Reload configuration.
    //   state (undef, "quit"): Force the player state after configuration.
    this.configure = function() {
      return this.jsonProcessParams('configure', [ 'state' ], arguments);
    };
    // Flush the assets database.
    //   scheduleonly (undef, 0, 1): 1=Flush schedules only (not contents/playlists).
    this.flush = function() {
      return this.jsonProcessParams('flush', [ 'scheduleonly' ], arguments);
    };
    // Ingest new contents/playlists/schedules.
    //   directory (string): Directory to ingest contents from.
    this.ingest = function() {
      return this.jsonProcessParams('ingest', [ 'directory' ], arguments);
    };
    // CCP Monitoring.
    // params: {
    //   lasttime (undef, date): "YYYY/MM/DD hh:mm:ss" or seconds since epoch (UTC).
    // }
    this.monitoring = function(params, asyncCb) {
      return this.jsonProcess('monitoring', undefined, asyncCb);
    };
    // Full Monitoring.
    // params: {
    //   lasttime (undef, date): "YYYY/MM/DD hh:mm:ss" or seconds since epoch (UTC).
    //   incremental (undef, bool): 1 for incremental alarms (requires lasttime).
    //   full (undef, bool): 1 to request full checks (vs events DB query only).
    //   assets (undef, bool): 0 to disable missing assets check.
    //   debug (undef, bool): 1 to get debug events.
    // }
    this.fullmonitoring = function(params, asyncCb) {
      return this.jsonProcess('fullmonitoring', params, asyncCb);
    };
    // Get contents to recover.
    //   scid (undef, integer): Schedule fragment to get contents for.
    //   preload (undef, date): "YYYY/MM/DD hh:mm:ss" or seconds since epoch.
    // This methods needs an output stream: not yet supported on jsonrpc.
    //this.recovery = function () {
    //  return this.jsonProcessParams('recovery', [ 'scid', 'preload' ], arguments);
    //}
    // Reload the assets database, using schedules/playlists/contents already ingested.
    //   scheduleonly (undef, 0, 1): 1=Relaod schedules only (not contents/playlists).
    this.reload = function() {
      return this.jsonProcessParams('reload', [ 'scheduleonly' ], arguments);
    };
    // Rotate logs.
    this.logrotate = function(asyncCb) {
      return this.jsonProcess('logrotate', undefined, asyncCb);
    };
    // Force a scheduler update.
    this.update = function(asyncCb) {
      return this.jsonProcess('update', undefined, asyncCb);
    };
    //---------------------------------------------------------
    //  Per logical player functions
    //---------------------------------------------------------

    // Control audio mute.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   on (undef, 0, 1): 1=Set, 0=Unset mute. Default: 1.
    //   override (undef, "man", "semi"): override mode.
    this.audioMute = function() {
      return this.jsonProcessParams('audioMute', [ 'playerid', 'on', 'override' ], arguments);
    };

    // Control audio volume.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   pct (0-100): Volume percentage.
    this.audioVolume = function() {
      return this.jsonProcessParams('audioVolume', [ 'playerid', 'pct' ], arguments);
    };

    // Clear a property.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   key (string): Property name to clear.
    this.clearProperty = function() {
      return this.jsonProcessParams('clearProperty', [ 'playerid', 'key' ], arguments);
    };

    // Cleanup expired entries in the assets database.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    this.configuration = function() {
      return this.jsonProcessParams('configuration', [ 'playerid' ], arguments);
    };

    // Control display power.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   on (undef, 0, 1): 1=On, 0=Off. Default: 1.
    //   override (undef, "man", "semi"): override mode.
    this.displayPower = function() {
      return this.jsonProcessParams('displayPower', [ 'playerid', 'on', 'override' ], arguments);
    };

    // Start a playlist.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   playlist (undef, integer, string): Playlist ID or name.
    //     It is recommended to look up the playlist using assets interface, and use its UID here.
    //     This parameter is ignored if uid is provided.
    //   override (undef, "man", "auto"): override mode (man by default).
    //   asset: (undef, integrer): Unique asset ID (obtained using the assets interface).
    //     'playlist' must be defined when uid is not defined.
    //     Use undef to deactivate the override.
    this.play = function() {
      return this.jsonProcessParams('play', [ 'playerid', 'asset', 'override' ], arguments);
    };

    // Update regional playlist.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    this.plupdate = function() {
      return this.jsonProcessParams('plupdate', [ 'playerid' ], arguments);
    };

    // Quit the player.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    this.quit = function() {
      return this.jsonProcessParams('quit', [ 'playerid' ], arguments);
    };

    // Restart the player.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    this.restart = function() {
      return this.jsonProcessParams('restart', [ 'playerid' ], arguments);
    };

    // Set a configuration parameter.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   key (string): Parameter key (module.name).
    //   value (string): Parameter value.
    this.setConfig = function() {
      return this.jsonProcessParams('setConfig', [ 'playerid', 'key', 'value' ], arguments);
    };

    // Set a property.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   key (string): Property key (module.name).
    //   value (string): Property value.
    this.setProperty = function() {
      return this.jsonProcessParams('setProperty', [ 'playerid', 'key', 'value' ], arguments);
    };

    // Show/hide the player.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   show (undef, 0, 1): undef/1=show, 0=hide.
    this.show = function() {
      return this.jsonProcessParams('show', [ 'playerid', 'show' ], arguments);
    };

    // Show/hide the player.
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   boot (undef, 0, 1): 1=Boot time only. This reinitializes the player.
    //   fast (undef, 0, 1): Fast start, for debugging.
    this.start = function() {
      return this.jsonProcessParams('start', [ 'playerid', 'boot', 'fast' ], arguments);
    };

    // Stop the player (plays a black screen).
    //   playerid (undef, integer): Logical player ID (undef for all players).
    this.stop = function() {
      return this.jsonProcessParams('stop', [ 'playerid' ], arguments);
    };

    // Pause the player
    this.pause = function(asyncCb) {
      return this.jsonProcess('pause', undefined, asyncCb);
    };
    // Resume the player
    this.resume = function(asyncCb) {
      return this.jsonProcess('resume', undefined, asyncCb);
    };
    // Screenshot generation
    //   playerid (undef, integer): Logical player ID (undef for all players).
    //   directory (string): Destination directory for images,
    //   file (string): image base name and ext for generated image files,
    //   size (undef, integer): maximum width/height of generated files (undef for max).
    // Return a hash describing the screenshot metadata: {
    //   error: error message when the screenshot generation failed, not set otherwise.
    //      internal error:       an exception occurred. Check 'exception' message.
    //      invalid directory:    the specified directory does not exist.
    //      directory redefined:  the same directory must always be used and another one
    //                            has been provided.
    //      too many screenshots: all screenshot slots are used. Retry later.
    //      no module defined:    no (player) module defined to get the screenshot from.
    //   exception: Exception string, for 'internal error' error.
    //   data: { When error is defined: provide addition information.
    //   },
    //   subdir: subdirectory where screenshot files are cached (for 10mn).
    //   // Screenshot per channel
    //   channels: [
    //     error: error message when the channel screenshot generation failed, not set otherwise.
    //        internal error:       an exception occurred. Check 'exception' message.
    //        screenshot failed:    unexpected error. Please report a bug.
    //     // Array of screenshots.
    //     shots: [
    //       error: image generation error
    //           no image: no image generated (from camera).
    //       id:    display id
    //       geometry: screenshot and overlays geometry: "<X>x<Y>" format.
    //       screenshot:   screenshot file name (relative to screenshot 'subdir').
    //       desktop:      temporary desktop file, rescaled.
    //       desktop-full: temporary desktop file, full resolution.
    //       video:        temporary video file (when composited in desktop image).
    //       display: {
    //         total: number of displays attached to this player (total - on - off = disconnected).
    //         on:    number of displays on
    //         off:   number of displays off
    //       },
    //       state:   player state
    //           'player not running'
    //           'player off'
    //       source: Error message linked to the screenshot source.
    //           'no video adapter':  No adapter (Xorg off or display disconnected)
    //           'no playlist':  No playlist defined.
    //           'player not running': Player (supposed to provide the screenshot) is not running.
    //           'player unreachable': Player (supposed to provide the screenshot) is unreachable.
    //           'unknown source':    Internal error, please report.
    //           'screenshot failed': Taking the screenshot at system level failed.
    //           Other strings representing the player state.
    //       title: image title, optional. Used for camera shots only.
    //     ],
    //     show:   0 when there is no display attached.
    //     title:  channel title, optional
    //     id:     channel id
    //   ]
    // }
    this.screenshot = function(asyncCb) {
      return this.jsonProcess('screenshot', [ 'playerid', 'directory', 'size' ], asyncCb);
    };
  }
  playerInterface.prototype = Object.create(baseInterface.prototype);
  playerInterface.prototype.constructor = playerInterface;

  /*
   * Properties interface.
   */
  var propertiesInterface = function(origin) {
    baseInterface.call(this, 'Properties', origin);

    /* Get a property
     * name: Property name to get, eg tags.mytag
     * return the property value.
     */
    this.getProperty = function(name, asyncCb) {
      return this.jsonProcess('getProperty', { name: name }, asyncCb);
    };

    /* Set a property
     * name: Property name to set
     * value: Property value.
     * return true on success.
     */
    this.setProperty = function(name, value, asyncCb) {
      return this.jsonProcess('setProperty', { name: name, value: value }, asyncCb);
    };

    /* Delete a property
     * name: Property name to delete
     * return true on success.
     */
    this.deleteProperty = function(name, asyncCb) {
      return this.jsonProcess('deleteProperty', { name: name }, asyncCb);
    };

    /* Get properties
     * names: array of property names to get.
     * return a hash of property name/value pairs.
     */
    this.getProperties = function(names, asyncCb) {
      return this.jsonProcess('getProperties', { names: names }, asyncCb);
    };

    /* Query properties
     * ns:    property namespace ('tags' for tags).
     * key:   property key (eg tag name).
     * ekey:  property key glob (with unix-like wildcard).
     * flags: property flag: local,remote,override or all. undef to get highest priority values only.
     * return { <ns>: { <key>: { values: [ <list of values ], flags => <comma-separated flag string>} } }.
     */
    this.queryProperties = function(params, asyncCb) {
      return this.jsonProcess('queryProperties', params, asyncCb);
    };
  }
  propertiesInterface.prototype = Object.create(baseInterface.prototype);
  propertiesInterface.prototype.constructor = propertiesInterface;

  /*
   * State interface.
   * Allow to record events and states in the State DB.
   * Events from error level are reported to CM.
   */
  var stateInterface = function(origin) {
	baseInterface.call(this, 'State', origin);

    /* Add an event.
     * params: {
     *   ns:    namespace
     *   name:  event name (ns.name is the event ID).
     *   level: error level (debug, info, notice, warn, error, critic, alert, emerg).
     *   msg:   optional message (should not vary for a given ns.name)
     *   data:  optional data object.
     *   time:  optional event timestamp (current time when not provided).
     * }
     * return 1 on success, 0 otherwise.
     */
    this.addEvent = function(params, asyncCb) {
      return this.jsonProcess('addEvent', params, asyncCb);
    };

    /* Update a state event.
     * params: {
     *   ns:    namespace
     *   name:  event name (ns.name is the event ID).
     *   level: error level (debug, info, notice, warn, error, critic, alert, emerg).
     *   msg:   optional message (should not vary for a given ns.name)
     *   data:  optional data object (should not vary between samples of a given state).
     *   time:  optional event timestamp (current time when not provided).
     *   ok:    0 to set/update the error state, 1 to clear the error state.
     * }
     * return 1 on success, 0 otherwise.
     */
    this.updateStateEvent = function(params, asyncCb) {
      return this.jsonProcess('updateStateEvent', params, asyncCb);
    };

    /* Clear a state event.
     * params: {
     *   ns:    optional namespace
     *   name:  optional event name, wildcards accepted (*, ?)
     *   time:  optional event timestamp (current time when not provided).
     * }
     * return 1 on success, 0 otherwise.
     */
    this.closeStateEvents = function(params, asyncCb) {
      return this.jsonProcess('closeStateEvents', params, asyncCb);
    };

    /* Delete old events.
     * All event older than 7 days will be removed.
     * secs: max age of events to keep (when < 7 days).
     * return 1 on success, 0 otherwise.
     */
    this.cleanupEvents = function(secs, asyncCb) {
      return this.jsonProcess('cleanupEvents', { seconds: secs }, asyncCb);
    };

    /* Looup events.
     * params: {
     *   ns:      optinal namespace.
     *   name:    optional event name.
     *   level:   optional error level.
     *   current: 1 for current states, 0 for passed states as well.
     *   since:   Since a given datetime (excluded).
     *   until    Until a given datetime (included).
     * }
     * return [
     *   {
     *     ns:        namespace
     *     name:      event name
     *     level:     error level
     *     count:     number of occurences
     *     firsttime: time of first occurence
     *     lasttime:  time of last occurence
     *     msg:       message
     *     longmsg:   long message (possibly with data)
     *     data:      data object
     *   }
     * ].
     */
    this.lookupEvents = function(params, asyncCb) {
      return this.jsonProcess('lookupEvents', params, asyncCb);
    };
  }
  stateInterface.prototype = Object.create(baseInterface.prototype);
  stateInterface.prototype.constructor = stateInterface;

  var avInstances = [];
  var avInterfaces = [
    'anydb',
    'assets',
    'player',
    'properties',
    'state'
  ];
  function instance(name, origin) {
    var iface;
    switch (name) {
    case "anydb":
      iface = new anydbInterface(origin);
      break;
    case "player":
      iface = new playerInterface(origin);
      break;
    case "properties":
      iface = new propertiesInterface(origin);
      break;
    case 'assets':
      iface = new assetsInterface(origin);
      break;
    case 'state':
      iface = new stateInterface(origin);
      break;
    default:
      throw Error("unknown JSON interface " + name);
    }
    return iface;
  }
  return function(name, origin) {
    if (name === undefined) {
      return avInterfaces;
    }
    if (origin !== undefined) {
      return instance(name, origin);
    }
    if (avInstances[name] === undefined) {
      avInstances[name] = instance(name);
    }
    return avInstances[name];
  };
})();

var SPECTRA = window.SPECTRA = {
  setImpl: function(task) {
    var
      that = this,
      utils = libutils,
      promise_ = (task||{}).promise,
      defer = that.Promise.Deferred(),
      isFunction = utils.isF,
      promise = isFunction(promise_)? promise_(): null,
      RO = utils.RO; // Utils must be defined first

    function resolve(impl) {
      if (impl.mode === 'player' && SPECTRA.staticConfig.devmode) {
        impl = {
          mode: 'standalone',
          id: 'standalone'
        };
      }

      RO(that, {
        impl: RO({}, impl)
      });
      defer.resolve(that.impl);
    }
    if (promise && isFunction(promise.then) && isFunction(promise.catch)) {
      promise.then(resolve);
      promise.catch(function(why) {
        defer.reject(why);
      });
    } else {
      resolve(task);
    }

    RO(that, {
      implTask: defer.promise()
    });

    delete that.setImpl;
  }
};

(function(context, SPECTRA) {
 var
    STR_FUNCTION = 'function',
    decodeURIComponent = context.decodeURIComponent,
    libutils = context.libutils,
    libpubsub = context.libpubsub,
    call = libutils.call,
    isa = libutils.isa,
    RO = libutils.RO;


  function JQueryDeferredToPromise(promise) {
    var result = new PromiseType(function(resolve, reject) {
      promise.then(resolve).fail(reject);
    });
    result.catch(PromiseType.rethrow);
    return result;
  }
  function PromiseToJQueryDeferred(promise) {
    var task = $.Deferred();
    promise.then(function(x) {
      task.resolve(x);
      return x;
    }).catch(function(why) {
      task.reject(isa(why, Error)? why.toString(): why);
    });
    return $.when(task);
  }
  $.Promise = PromiseToJQueryDeferred;

  function OneTimePromise(ctor) {
    var task;
    return function() {
      return (task = task||ctor());
    };
  }

  libutils.ORMs(String.prototype, {
    singleQuoted: function() {
      return "'" + this.valueOf() + "'";
    },
    // from https://gist.github.com/Breton/2699916
    escape: function () {
        "use strict";
        var escapable = /[.\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
            meta = { // table of character substitutions
                '\b': '\\b',
                '\t': '\\t',
                '\n': '\\n',
                '\f': '\\f',
                '\r': '\\r',
                '\.': '\\.',
                '"': '\\"',
                '\\': '\\\\'
            };

        function escapechar(a) {
            var c = meta[a];
            return libutils.isStr(c) ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }
        return this.replace(escapable, escapechar);
    },

    // from https://gist.github.com/Breton/2699916
    blobtoregex: function() {
      return new RegExp(this.blobtoregexstring());
    },
    blobtoregexstring: function() {
        //Translate a shell PATTERN to a regular expression.
        //There is no way to quote meta-characters.
        "use strict";
        var pat = this;
        var i=0, j, n = pat.length || 0,
            res, c, stuff;
        res = '^';
        while (i < n) {
            c = pat[i];
            i = i + 1;
            if (c === '*') {
                res = res + '.*';
            } else if (c === '?') {
                res = res + '.';
            } else if (c === '[') {
                j = i;
                if (j < n && pat[j] === '!') {
                    j = j + 1;
                }
                if (j < n && pat[j] === ']') {
                    j = j + 1;
                }
                while (j < n && pat[j] !== ']') {
                    j = j + 1;
                }
                if (j >= n) {
                    res = res + '\\[';
                } else {
                    stuff = pat.slice(i, j).replace('\\', '\\\\');
                    i = j + 1;
                    if (stuff[0] === '!') {
                        stuff = '^' + stuff.slice(1);
                    } else if (stuff[0] === '^') {
                        stuff = '\\' + stuff;
                    }
                    res = res + '[' + stuff + ']';
                }
            } else {
                res = res + (c).escape();
            }
        }
        return res + '$';
    }
  });

  function matchUnixBlob(str, blob) {
    if (blob == null || str == null) {
      return null;
    }

    str = '' + str;
    blob = '' + blob;
    return str.match(blob.blobtoregex());
  }

  // $.each, but dont list functions.
  function eachprop(obj, cb) {
    Object.keys(obj).forEach(function(name) {
      return cb(name, obj[name]);
    });
  }

  function safeJSONParse(str, fail_result) {
    var result;
    try {
      result = JSON.parse(str);
    } catch(e) {
      result = fail_result;
    }
    return result;
  }

  $.Deferred.onetime = function(closure) {
    function Handler() {
      var task;
      return function OneTimeClosure() {
        if (!task) {
          task = closure();
        }
        return $.when(task).fail(function(why) {
          task = null;
        });
      };
    }
    return new Handler();
  };

  /**
   * RFC3339 formatting
   * http://tools.ietf.org/html/rfc3339
   *
  **/
  function DateToRFC3339(epoch) {
    return new Date(epoch).toISOString(); // we might need an external lib.
  }
  function RFC3339ToDate(rfc3339) {
    return Date.parse(rfc3339); // we might need an external lib
  }

  function PubsubEventBridge(exchangeName, exchangeArgs) {
    if (!libutils.isa(this, PubsubEventBridge)) {
      return new PubsubEventBridge(exchangeName, exchangeArgs);
    }
    var
      self = this,
      once = false,
      pipes = {},
      pendingpipes = [],
      connected = false,
      client;

    function NotifyError(error) {
      call(self, 'onerror', error);
    }
    if (!libpubsub || !libpubsub.FSClient) {
      setTimeout(function() {
        NotifyError({
          msg: 'missing libpubsub.FSClient'
        })
      });
      return RO({}, {
        listen: libutils.noop
      });
    }

    function ForwardPubsubEvent(event) {
      call(self, 'onevent', event);
    }

    function validateString(arg) {
      var to = typeof arg;
      if (to !== 'string') {
        throw new TypeError('Expected string, got ' + to);
      }
    }
    function Subscribe(name) {
      validateString(name);
      if (client && connected) {
        if (1 === (pipes[name] = pipes[name]? pipes[name]++:1)) {
          client.subscribe(name, ForwardPubsubEvent);
        }
      } else {
        pendingpipes.push(name);
      }
    }
    function Unsubscribe(name) {
      validateString(name);
      if (client && connected) {
        if (pipes[name]-- === 0) {
          client.unsubscribe(name);
        }
      }
    }
    function SubscribeMany(arrayLike) {
      Array.prototype.forEach.call(arrayLike, Subscribe);
    }

    client = new libpubsub.FSClient(exchangeName);
    client.connect(null, null, exchangeArgs);
    client.onopen = function() {
      connected = true;
      SubscribeMany(pendingpipes);
      call(self, 'onopen');
      pendingpipes = [];
    };
    client.onerror = client.onclose = function(evt) {
      pipes = [];
      pendingpipes = [];
      if (client) {
        client.close();
      }
      client = null;
      connected = false;
      call(self, 'onerror', evt);
    };
    client.onrouting = function(evt) {
      call(self, 'onrouting', evt);
    };
    RO(self, {
      listen: Subscribe
    });
  };

  /**
   * Shared exposed utility code in SPECTRA
   * @namespace utils
   * @memberof SPECTRA
  **/
  var utils = RO({}, {
    RO: RO,
    getSearch: libutils.getSearchParam,
    isa: isa,
    JQD2P: JQueryDeferredToPromise,
    P2JQD: PromiseToJQueryDeferred,
    once: OneTimePromise,
    getType: libutils.tof,
    isString: libutils.isStr,
    safeJSONParse: safeJSONParse,
    isWildCard: libutils.iswc,
    wildCardToRegex: libutils.wctoregex,
    /**
     * Generate a random UUIDV4
     * @memberof SPECTRA.utils
     * @method
     * @returns {UUIDv4}
    **/
    randomUUIDv4:  libutils.UUIDv4,
    /**
     * Convert a unix epoch to RFC3339 format
     * @memberof SPECTRA.utils
     * @method
     * @param {number} Unix epoch
     * @returns {RFC3339} Date/Time
    **/
    DateToRFC3339: DateToRFC3339,
    /**
     * Convert an RFC3339 to unix epoch
     * @memberof SPECTRA.utils
     * @method
     * @param {RFC3339} Date/Time
     * @returns {number} Unix epoch
    **/
    RFC3339ToDate: RFC3339ToDate,
    /**
     * Test a string against a unix blob pattern
     * @memberof SPECTRA.utils
     * @method
     * @param {string} src string to test
     * @param {string} blob unix-style blob to test src against
     * @returns {array} Regex match or null if no match
    **/
    matchUnixBlob: matchUnixBlob,
    eachprop: eachprop,
    noop: libutils.noop,
    PubsubEventBridge: PubsubEventBridge
  });
  RO(SPECTRA, {
    utils: utils,
    Promise: libutils.Promise,
  });
})(this, SPECTRA);

(function(SPECTRA, context) {
/**
   * Read in configuration from script tag and location.search
   * The priority is: Defaults < Script attributes < Location.search
   * [SCRIPT]       [search]        [type]  [default]
   * cachejs        sapi-cachejs    bool    true
   * init-timeout   sapi-init-to    number  5000
   * load-timeout   sapi-load-to    number  30
   * impl           sapi-impl       string  null
   * log            sapi-log        string  null
   *
  **/
  var
    spectraUtils = SPECTRA.utils,
    getFromLocation = spectraUtils.getSearch,
    search,
    CACHEJS='cachejs',
    IMPL='impl',
    TIMEOUT='timeout',
    SAPI='sapi-',
    LOG='log',
    SRC_API_MSG = "Expected: spectra.api in script src",
    getFromScriptTag,
    src,
    __SPECTRA = context.__SPECTRA;

  if (__SPECTRA) {
    getFromScriptTag = spectraUtils.noop;
    search = __SPECTRA.root;
    src = __SPECTRA.root;
  } else {
    var
      scripts = document.getElementsByTagName('script'),
      script = scripts[scripts.length - 1];
    getFromScriptTag = function(name) {
      return script.getAttribute(name);
    };
    src = getFromScriptTag('src');
  }

  var
    isImpl = src.indexOf(".impl") !== -1, // look for impl.
    apiIndex = src.toLowerCase().lastIndexOf('/spectra.api');

  if ( apiIndex === -1 || isImpl ) {
    throw new Error(SRC_API_MSG);
  }
  var config = {
    src   : src,
    root  : src.substring(0, apiIndex+1),
  },
  warnings = [],
  debugs =   [];

  function deprecated(type, is, want) {
    // warnings.push(type + " attribute '" + is + "' deprecated. Use '" + want + "'");
  }

  var NULL;
  var params = [
// [CONFIG.name]      [default]   [tag attribute]   [old tag]     [URL]             [old URL]
   [CACHEJS,          true,       CACHEJS,          NULL,         SAPI+CACHEJS,     NULL],
   ['initTimeout',    5000,       'init-'+TIMEOUT,  TIMEOUT,      SAPI+'init-to',   NULL],
   ['moduleTimeout',  30,        'load-'+TIMEOUT,  'module-to',   SAPI+'load-to',   NULL],
   [IMPL,             NULL,       IMPL,             NULL,         SAPI+IMPL,        IMPL],
   [LOG,              '',         LOG,              'debug',      SAPI+LOG,         NULL],
   ['osd',            NULL,       'osd',            NULL,         SAPI+'osd',       NULL],
   ['legacyBI',       true,       'legacyBI',       NULL,         SAPI+'bi',        NULL],
   ['devmode',        false,      '',               NULL,         SAPI+'dev',       NULL],
   ['devcomm',        false,      '',               NULL,         SAPI+'dev-comm',  NULL],
  ];

  params.forEach(function(info, index)  {
    var
      key = info[0],
      defv = info[1],
      tag = info[2],
      tagd = info[3],
      url = info[4],
      urld = info[5],
      value = defv;

    // get value from deprecated tag attribute
    value = getFromScriptTag(tagd, value) || value;
    if (value !== defv) {
      deprecated('tag', tagd, tag);
    }
    // get value from tag attribute
    value = getFromScriptTag(tag) || value;

    // get from deprecated URL
    var urldValue = getFromLocation(urld, null);
    if (urldValue != null) {
      deprecated('url', urld, url);
      value = urldValue;
    }

    // get from URL
    value = getFromLocation(url, value);

    // validate typeofs
    var type = spectraUtils.getType(defv);
    if (type === 'boolean') {
      value = (value === 'true') || (value == 1);
    } else if (type === 'number') {
      value = parseInt(value);
      if (isNaN(value)) {
        value = null;
      }
    }

    if (defv !== NULL && (typeof value !== type)) {
      debugs.push('Expected type', type, 'for', key +'. Got', typeof value +'. Using', defv);
      value = NULL;
    }

    value = (value == null)? defv : value;
    if (value != defv) {
      debugs.push('Overriding ' + key + ': ' + defv + ' -> ' + value);
    }
    config[key] = value;
  });

  delete config[IMPL];

  spectraUtils.RO(SPECTRA, {
    staticConfig: spectraUtils.RO({
      _msg: {
        warn:   warnings,
        debug:  debugs
      }
    }, config)
  });
})(SPECTRA, this);

(function(context, SPECTRA) {

  /**
   *  This type allows two means to represend a list of strings. 'a,b,c' and ['a','b','c'] are equivalent.
   *  @typedef {(string|Array.<string>)}   stringList
   *  @memberof Logging
   */
  /**
   *  Convert a {@link Logging.stringList} to an array of strings
   *  @param {Logging.stringList} stringList String to convert
   *  @private
   *  @memberof Logging
   */
  var
    STR_PIPE    = 'pipe',
    STR_NOPIPE  = 'nopipe',
    STR_ESFC    = 'excludeSinksFromChannels',
    STR_PTS     = 'pipeToSinks',
    STR_PCTS    = 'pipeChannelsToSinks',
    liblog = context.liblog,
    liblogChannel = liblog.Channel,
    liblogPipe =    liblog.pipe,
    libutils = context.libutils,
    proxy = libutils.proxy,
    proxies = [
      proxy(liblog, STR_PIPE),
      proxy(liblog, STR_NOPIPE),
      proxy(liblog, 'OSD')
    ],
    slog = liblog('spectra.log'),
    RO = libutils.RO;

  /*
   * Initialize loggers from debug string.
   *   debugstr: "levels:trace,debug,info,...;channels:all;sinks:all"
   */
  function setDebug(debugstr) {
    if (!debugstr || !debugstr.length) {
      return;
    }
    var typesStrings = debugstr.split(';');
    var data = {};
    typesStrings.forEach(function(v) {
      var typeIndex = v.indexOf(':');
      data[v.substr(0, typeIndex)] = v.substr(typeIndex + 1).split(',');
    });
    var
      channels = data.channels,
      sinks = data.sinks,
      levels = data.levels;
    if (channels && sinks) {
      liblogPipe(channels, sinks);
    }
    if (levels) {
      console.log('levels', levels);
    }
  }

////////////////////////////////////
////// BEGIN DEPRECATED
  var
    STR_NO_ALT = '(no alternative)',
    STR_LIBLOG = 'liblog.',
    STR_LIBLOG_REGISTER_SINK = STR_LIBLOG + 'sinks.add',
    deprecateOnce={},
    deprecated = {
      registerNewSink           : 'OSD, ' + STR_LIBLOG_REGISTER_SINK,
      _registerSinkCTOR         : STR_LIBLOG_REGISTER_SINK,
      setPermanent              : STR_NO_ALT,
      enableLogLevels           : STR_NO_ALT,
    };

  function logDeprecated(name, see) {
    if (!deprecateOnce[name]) {
      // slog.warn('DEPRECATED', name, 'see', see);
      deprecateOnce[name] = 1;
    }
  }

  function proxyLogReprecated(name, see) {
    return function() {
      // logDeprecated(name, see);
    };
  }

  for (var k in deprecated) {
    deprecated[k] = proxyLogReprecated(k, deprecated[k]);
  }
  function deprecatedNotice(name, see, closure) {
    return function() {
      // logDeprecated(name, see);
      return closure.apply(0,arguments);
    };
  }
  deprecated[STR_PTS]  = deprecatedNotice(STR_PTS,STR_PIPE,proxies[0]);
  deprecated[STR_PCTS] = deprecatedNotice(STR_PCTS,STR_PIPE,proxies[0]);
  deprecated[STR_ESFC] = deprecatedNotice(STR_ESFC,STR_NOPIPE,proxies[1]);

////// END DEPRECATED
////////////////////////////////////


  function forwardEnable(closure) {
    return function(names, enable) {
      return closure.call(liblog, names, !libutils.defv(enable,1));
    };
  }

  var log = libutils.log;
  function SpectraLOG(channel) {
    return liblog(channel);
  }

  var API = RO(RO(SpectraLOG, {
    _getLogTypes: function() {return liblog.LEVELS;},
    //  _registerSinkCTOR: //deprecated
    //  registerNewSink: //deprecated
    //  setPermanent: //deprecated
    isChannelEnabled          : libutils.not(liblog.channels.muted, liblog),
    enableChannels            : forwardEnable(liblog.channels.mute),//enableChannels,
    enableSinkTypes           : forwardEnable(liblog.sinks.mute),//enableSinks,
    nopipe                    : proxies[1],
    OSD                       : proxies[2],
    pipe                      : proxies[0],
    getLogger                 : liblogChannel, // TODO: deprecate
    get                       : liblogChannel, // TODO: deprecate
    setDebug                  : setDebug,
  }), deprecated);

  libutils.ODP(SPECTRA, 'loggerLib', {
    get: function() {
      // logDeprecated('loggerLib', 'log');
      return API;
    }
  });
  RO(SPECTRA, {
    log: API,
  });
})(this, SPECTRA);


/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
SPECTRA.setImpl({
  id:   'multiplayer',
  mode: 'player'
});

(function AVP1905reportErrors(window, SPECTRA) {
  // AVP-1905 - reporting
  var _alarmLogger = SPECTRA.log('spectra.alarm');

  window.addEventListener("error", function (event) {
    var element = event.target||{},
      tagName = element.tagName,
      url = element.href || element.src;

    if(['VIDEO', 'IMG', 'SCRIPT', 'LINK'].indexOf(tagName) != -1) {
      var alarm = 'load error: ' + tagName + ':' +url;
      _alarmLogger.error(alarm);
    }
  }, true);
  window.onerror = function(msg, src, line, column, error) {
    var alarm = Array.prototype.slice.apply(arguments, [0,-1]).join(':');
    if (SPECTRA.staticConfig.devmode) {
      console.error('alarm', arguments);
    }
    _alarmLogger.error(alarm);
    return true;
  };
})(window, SPECTRA);

(function(SPECTRA){
  // By default, $.getScript() does not cache files.
  var
    spectraUtils = SPECTRA.utils,
    scripts_ = {},
    RO = spectraUtils.RO,
    CONFIG = SPECTRA.staticConfig,
    slog = SPECTRA.log('spectra.load'),
    scriptLog = SPECTRA.log('spectra.scripts');

  function getScript(url) {
    return $.ajax({
      cache:    !!CONFIG.cachejs,
      dataType: 'script',
      url:      url
    }).then(undefined,
      function(xhr, status, error) {
      return {
        cause: 'ajax',
        xhr:    xhr,
        status: status,
        error:  error
      };
    });
  }
  // Load an application json data file.
  //   rul: script location, relative to the application location.
  // Return a promise(script, testStatus, jqXHR).
  function load_json(url) {
    slog.log('loading ', url, '...');
    return $.getJSON(url).done(function(data) {
      slog.log('loading ' + url + ' done');
    }).fail(function(xhr, textStatus) {
      slog.error('loading ' + url + ' failed: ' + textStatus);
    });
  }

  function simple_load_script_(path) {
    scriptLog.log("Loading '" + path + "' ...");
    var task = scripts_[path];
    if (task === undefined) {
      task = scripts_[path] = getScript(path).then(function(script, status) {
        scriptLog.log("Loading '" + path + "' done (" + status + ")");
        return; // Returns nothing, so this promise can be used in modules.define() dependencies.
      }, function(why) {
        scriptLog.error("Loading '" + path + "' failed: ", why);
        return why;
      });
    }
    return task;
  }

  RO(SPECTRA, {
    load: RO({}, {
      script: getScript,
      cachedScript: simple_load_script_,
      json: load_json,
    }),
    // legacy
    load_script: simple_load_script_,
    load_json: load_json,
  });
})(SPECTRA);

(function(context, SPECTRA) {
  var
    RO = libutils.RO,
    API = {},
    once = {},
    log = SPECTRA.log('spectra');

  if (SPECTRA.staticConfig.devmode) {
    log.pipe('console');
  }
  function warn(msg) {
    log.warn(msg);
  }

  function soon(what) {
    // log.warn("'" + what + "' is deprecated and will soon be removed");
  }

  function moved(what, where) {
    // warn("'" + what + "' moved to '" + where + "'.");
  }

  function gone(what, where) {
    // warn("'" + what + "' has been removed");
  }
  function notifyOnce(type, what, alt) {
    if (type === 'once') {
      return;
    }
    if (!once[what]) {
      API[type].call(API, what, alt);
      once[what] = 1;
    }
  }

  RO(API, {
      warn:   warn,
      moved:  moved,
      gone:   gone,
      soon:   soon,
      once:   notifyOnce,
  });
  RO(SPECTRA, {
    deprecation: API
  });
})(this, SPECTRA);

try {
(function(SPECTRA) {
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /*
   * Module management
   * Private interface.
   *
   */
  var
    spectraUtils = SPECTRA.utils,
    spectraLoad  = SPECTRA.load,
    isString = spectraUtils.isString,
    RO = spectraUtils.RO,
    deferred$ = $.Deferred,
    extend$ = $.extend,
    when$ = $.when,
    isFunction$ = $.isFunction,
    CONFIG = SPECTRA.staticConfig,
    script_path = CONFIG.root,
    getScript = spectraLoad.script;

  var modules_map;      // Filled when the spectra.api.impl is loaded.
  var modules_paths = { // Can be overridden by spectra.api.impl
    IMPL:     script_path + 'impl/',
    PUBLIC:   script_path,
    PRIVATE:  script_path
  };
  // Module paths.
  var
    mlog = SPECTRA.log('spectra.modules'),
    slog = SPECTRA.log('spectra'),
    modules_ = {};              // available or requested modules;

  // Ensure an api implementation is loaded.
  var rootsSet = SPECTRA.implTask.then(function(impl) {
    // TODO: modify modules_map
    slog.debug('Spectra API implementation "', impl);
    return impl;
  });

  function _newmodule(name, timeout) {
    var
      module = deferred$(),
      timeoutHandle = setTimeout(function() {
        mlog.log('module ' + name.singleQuoted() + ' load timeout');
        module.reject({ name: name, error: 'module load timeout' });
      }, CONFIG.moduleTimeout * 1000);
    module.always(function() {
      timeoutHandle = clearTimeout(timeoutHandle);
    });
    return module;
  }

  // manage list of dependencies to resolve.
  var Modlist = function(parent) {
    return extend$(this, {
      modules: {},
      parent: parent.singleQuoted()
    });
  };
  extend$(Modlist.prototype, {
    add_require: function(name, file) {
      var self = this;
      mlog.log(self.parent + ' dependency ' + name + ' added: ', file);
      return _require(file).done(function(module) {
        // Wait for the closure completion.
        mlog.log(self.parent + ' dependency ' + name + ' resolved: ', file);
        self.modules[name] = module;
      }).fail(function(e) {
        mlog.error(self.parent + ' dependency ' + name + ' failed: ', file, e);
      });
    },

    add: function(dep) {
      var self = this;
      if (dep === undefined) {
        // Dependency on something not a module.
        return;
      }
      if (isString(dep)) {
        return self.add_require(dep, dep);
      }
      if (isFunction$(dep.promise)) {
        return dep.then(function(newdep) {
          return self.add(newdep);
        });
      }
      if (Array.isArray(dep)) {
        return when$.apply($, dep.map(function(newdep) {
          return self.add(newdep);
        }));
      }
      // { name: file } object.
      return when$.apply($, $.map(dep, function(v, k) {
        if (isFunction$(v.promise)) {
          return v.done(function(module) {
            self.modules[k] = module;
          });
        }
        return self.add_require(k, v);
      }));
    }
  });

  /*
   * define a module
   * @params:
   *    name: name of module we are defining
   *    deps_promise: dependencies to resolve before we can define module
   *      Can be a filename, an object of name:filename, a promise returning another deps_promise,
   *      or an array of any of the previous options.
   *    closure: module definition to call once deps_promise has been resolved.
   *
   */
  function _define(name, deps_promise, closure) {
    var name_log = name.singleQuoted();

    if (modules_[name] === undefined) {
      modules_[name] = _newmodule(name);
    } else if (modules_[name].state() !== 'pending') {
      mlog.warn(name_log + ' already defined. Ignored');
      return;
    }

    // allow modules without dependencies.
    if (closure === undefined) {
      closure = deps_promise;
      deps_promise = undefined;
    }

    var promise;
    if (deps_promise !== undefined) {
      var mods = new Modlist(name);
      promise = mods.add(deps_promise).then(function() { return mods.modules; });
    } else {
      mlog.log(name_log + ' has no dependencies.');
      promise = when$();
    }
    // Resolve to mods (hash of name:module).
    return promise.done(function(mods) {
      var module;
      try {
        module = closure(mods);
      } catch(e) {
        mlog.error(name_log + ' initialization error: ', e);
        modules_[name].reject(e);
        return;
      }
      // Wait for the closure completion.
      mlog.log(name_log + ': resolved');
      modules_[name].resolve(module);
    }).fail(function(e) {
      mlog.error(name_log + ' dependencies loadind failed: ', e);
      modules_[name].reject({ name: name, error: e });
    });
  }

  // Returns a promise that the module is ready
  function _require(name, timeout) {
    var log_name = name.singleQuoted();
    var deferred = modules_[name];

    if (deferred !== undefined) {
      mlog.log(log_name + ' already required/defined', deferred.state() );
      return deferred.promise();
    }
    deferred = modules_[name] = _newmodule(name, timeout);

    rootsSet.then(function() {
      var path;
      var file = name;
      if (name.charAt(0) === '/') {
        // Absolute path.
        path = '';
      } else if (modules_map !== undefined && modules_map[name] !== undefined) {
        path = modules_map[name];
      } else if (name.startsWith('widgets.')) {
        // widgets. are a special case, loaded as a java object (lib.lib.lib.object)
        var items = name.split('.');
        file = items.pop();
        path = script_path + items.join('/') + '/';
      } else if (name.startsWith('spectra.')) {
        if (name.endsWith('.impl')) {
          path = modules_paths.IMPL;
        } else {
          path = modules_paths.PUBLIC;
        }
      } else {
        // Relative to spectra.api.js.
        path = modules_paths.PRIVATE;
      }
      mlog.log(log_name + ' path : ' + path.singleQuoted());

      // Promise that the module is ready.
      var src_path = file + '.js';
      getScript(path + src_path).then(function() {
        // This log might confuse user, as it will be resolved after the javascript
        // So using a debug level here.
        mlog.debug(log_name + " loaded.");
      },function(why) {
        mlog.error(log_name + " loading from " + path + src_path + " failed", why);
        deferred.reject({ name: name, error: why });
      });
    });
    return deferred.promise();
  }

  function _require_json(url) {
    var result = {};
    result[url] = spectraLoad.json(url);
    return result;
  }

  function _require_script(url) {
    return spectraLoad.cachedScript(url);
  }

  function state() {
    return Object.keys(modules_).reduce(function(tgt, k) {
      tgt[k] = modules_[k].state();
      return tgt;
    }, {});
  }
  RO(SPECTRA, {
    modules: RO({}, {
      state   : state,
      define  : _define,
      require : _require,
      json    : _require_json,
      script  : _require_script
    })
  });
})(SPECTRA);
} catch(e) {console.error(e);}

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

// If SPECTRA_IMPL is not defined, then we are in standalone mode.
/*
 *  Public Spectra API.
 *  Requires jQuery 1.8 or higher.
 *
 *  _*() methods are private and must not be used outside of the Spectra API Private implementations.
 */

 /**
 * @file
 * Entry-point for {@link SPECTRA}:
 */
/**
 Date format in {@link www.ietf.org/rfc/rfc3339.txt RFC3339} format
 * @typedef {string} RFC3339
**/
/**
 Date format in {en.wikipedia.org/wiki/ISO_8601 ISO8601} format
 * @typedef ISO8601
**/
/**
 * @typedef MinMax
 * @property {number} min Minimum value
 * @property {number} max Maximum value
**/

/**
 * UUID as per {@link http://en.wikipedia.org/wiki/Universally_unique_identifier#Version_4_.28random.29 RFC4122}
 * @typedef {string} UUIDv4
 /**
  @class SPECTRA
 */
(function(window, SPECTRA) {
  "use strict";

  var
    libutils = window.libutils,
    SPECTRALog = SPECTRA.log,
    spectraUtils = SPECTRA.utils,
    CONFIG = SPECTRA.staticConfig,
    getType = spectraUtils.getType,
    isString = spectraUtils.isString,
    RO = spectraUtils.RO,
    SPECTRAPromise = SPECTRA.Promise,
    slog = SPECTRALog('spectra');


  if (CONFIG.osd) {
    try {
      var split = CONFIG.osd.split(':');
      SPECTRALog.registerNewSink('onscreen', 'onscreen', {
        div: split[0],
        table: split[1]!==''
      });
    } catch(e) {
    }
  }

  var getScript = SPECTRA.load.script;

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /*
   *  Script location and arguments.
   */
  var script_path = CONFIG.root;
  SPECTRALog.setDebug(CONFIG.log);


  CONFIG._msg.warn.forEach(function(v) {
    slog.warn(v);
  });
  CONFIG._msg.debug.forEach(function(v) {
    slog.debug(v);
  });
  delete CONFIG._msg;


  // Spectra API configuration
  var config = {
    root:    '',       // Defined once the implementation is loaded.
    mode:    'player', // Defined once the implementation is loaded.
    online:  true,  // Online mode: player services (websocket, jsonrpc) available.
    cache:   true   // Allow browser caching of files (JS/JSON). Disabled by default in offline mode.
  };
  /*
   *  Script loader.
   */

  // Private implementations, recorded and used by services.
  var impls = {};

  // Singleton private data.
  var player_config = {}; // See init_listen().
  var parentJsChannel = (function() {
    var
      noop = spectraUtils.noop,
      EMPTY_JS_CHANNEL = {
        bind: noop,
        call: noop,
        destroy: noop,
        notify: noop,
        unbind: noop
      },
      parentJsChannel;

    try {
      parentJsChannel = (window.top !== window)? Channel.build({
        window: window.parent,
        origin: '*',
        scope: 'net.activia.multiplayer.html'
      }): EMPTY_JS_CHANNEL;
    } catch(e) {
      slog.error(e);
      parentJsChannel = EMPTY_JS_CHANNEL;
    }
    return parentJsChannel;
  })();

  function callMPRPC(method, params, timeout) {
    var task = new SPECTRAPromise(function(resolve, reject) {
      parentJsChannel.call({
        method: 'rpc',
        params: {
          method: method,
          params: params
        },
        success: resolve,
        error: reject,
        timeout: timeout
      });
    });
    return spectraUtils.P2JQD(task);
  }
  function reportFatalError(error) {
    return callMPRPC('setError', error);
  }


  // Player configuration provided by the player, through event messaging.
  function initMsgExecutor(resolve, reject) {
    // Reject case;
    var initTO = setTimeout(function() {
      var error = 'Player data message timed out.';
      slog.error(error);
      reject(error);
    }, CONFIG.initTimeout || 15000);

    // TODO: clarify event.data messages.
    // event: {
    //   data: {
    //     playerId:       // Logical player ID. Starts at 0.
    //     playerGeometry: // Full player geometry?
    //     playerIp:       // Player IP, local?
    //     playerHostName: // Player Hostname, local?
    //     playlist: {
    //       name:         // Playlist name
    //     }
    //     regionName:     // Name of the SMIL region the app is running in.
    //     seek:           // ?
    //     ft:             // Fire Time, for synchronization.
    //     dur:            // Element duration.
    //     // General configuration
    //     debug:          // Debug log string (see SPECTRA.setDebug()).
    //   }
    // }
    function onWindowMessage(event) {
      var config_default = {
        playerId: 0,
        ft:       '00:00:00'
      };

      var parsed = event.data;
      if (isString(parsed)) {
        try {
          parsed = JSON.parse(parsed);
        } catch(e) {
          slog.error("Message event parsing failed: ", e);
          parsed = { type: '' };
        }
      }
      if (!parsed || parsed.type !== 'multiplayer.init') {
          return;
      }

      if (initTO !== undefined) {
        initTO = clearTimeout(initTO);
      }

      // Stop listening
      window.removeEventListener('message', onWindowMessage);

      player_config = parsed;
      for (var k in config_default) {
        if (player_config[k] == null) {
          player_config[k] = config_default[k];
        }
      }

      player_config.start_time = player_config.ft;
      delete player_config.ft;

      if (player_config.debug !== undefined) {
        SPECTRA.setDebug(player_config.debug);
        delete player_config.debug;
      }


      var
        playerHttp = player_config.playerHttp,
        resolvePlayerHttp,
        origin = location.origin || (location.protocol + '//' + location.host);

      if (playerHttp) {
        resolvePlayerHttp = SPECTRAPromise.resolve(playerHttp);
      } else {
        resolvePlayerHttp = SPECTRA.implTask.then(function() {
          switch(SPECTRA.impl.id) {
            case 'standalone':
            case 's200src':
              return origin.replace(location.port, '9000');
            default:
              return '';
          }
        });
      }

      resolvePlayerHttp.then(function(playerHttp) {
        player_config.playerHttp = playerHttp;
        slog.debug('initmsg resolved', player_config);
        // AVP-1678
        SPECTRA.cache.context = (player_config.playlist||{}).deviceId || '';
        resolve(player_config);
      }).catch(reject);
    }
    window.addEventListener("message", onWindowMessage, false);
  }

  var
    inits = {
      initmsg: new SPECTRAPromise(initMsgExecutor),
      loadapiimpl: SPECTRA.implTask.then(function(impl) {
        slog.debug('loadapiimpl resolved', impl);
        return impl;
      }).catch(function(e) {
        slog.error('loadapiimpl failed', e);
      })
    },
    allInits = RO(
      RO({}, {
        init: SPECTRAPromise.hash(inits).then(function() {
          slog.debug('SPECTRA.API is initialized');
        })
      }), inits);

  // API singleton.
  RO(RO(SPECTRA, allInits), {
    // Class data.
    REVISION: '2',

    _dump_init_promises: function() {
      for (var name in inits) {
        slog.log(name, inits[name]);
      }
    },

    setDebug: SPECTRALog.setDebug,
    reportFatalError: reportFatalError,
    callMPRPC: callMPRPC,
    /*
     *  Other functions...
     */

    // Change Spectra API configuration.
    //   cfg: {
    //     verbose: <true to enable verbose logs in the console>
    //   }
    configure: function(cfg) {
      for (var k in cfg) {
        config[k] = cfg[k];
      }
    },
    config: function() {
      return libutils.copy(config);
    },

    // Get the player configuration.
    get_player_config: function() {
      return player_config;
    },

    // Return the current player ID.
    playerId: function() {
      return player_config.playerId;
    },
  });
})(this, SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

/**
 * Utilities relating to caching
 * @namespace cache
 * @memberof SPECTRA
**/

/**
 * Cache backend
 * @class SPECTRA.cache.ICacheStorage
 * @abstract
 * @inner
 * @example
 * localStorage;
 * sessionStorage;
**/

/**
 * @method getItem
 * @instance
 * @memberof SPECTRA.cache.ICacheStorage
 * @param {string} name Name of item to query
 * @returns {string} value of item
**/

/**
 * Removes an item from storage
 * @method removeItem
 * @instance
 * @memberof SPECTRA.cache.ICacheStorage
 * @param {string} name Name of item to remove
**/

/**
 * @method setItem
 * @instance
 * @memberof SPECTRA.cache.ICacheStorage
 * @param {string} name   Name of item to set
 * @param {string} value  value to set
**/
SPECTRA.cache = (function() {
  var
    API,
    BASE_PREFIX = 'sapi.',
    DEFAULT_MAX_AGE = 1000 * 60 * 5,
    DEFAULT_PREFIX = BASE_PREFIX + '.',
    context = '', // AVP1678
    prefix = DEFAULT_PREFIX,
    defaultMaxAge = DEFAULT_MAX_AGE,
    libutils = window.libutils,
    defaultStorage = localStorage;

  function NormalizeTS(ts) {
    return ((ts == null) || isNaN(ts))? Date.now(): ts;
  }

  function NormalizeMaxAge(val) {
    return ((val == null) || isNaN(val))? API.defaultMaxAge: val;
  }
  function NormalizeStorage(storage) {
    return storage? storage: API.defaultStorage;
  }

  function isSingle(val) {
    var
      to = typeof val,
      io = ['string', 'number'].indexOf(to),
      is = io !== -1;
    return is;
  }

/**
 * @method get
 * @instance
 * @memberof SPECTRA.cache
 * @param {string|Array<string>} names Name or names of items to query
 * @returns {*|Map<string,*>} value of items
 * @example
 * SPECTRA.cache.set('foo', 'bar');
 * SPECTRA.cache.get('foo'); // 'bar'
 *
 * SPECTRA.cache.set('exp', 'gone', 500); // As if set at TS 500
 * SPECTRA.cache.get('foo', 50, 600 ); // null, since we don't want older than 50ms
 *
 * SPECTRA.cache.set('exp2', 'set');
 * setTimeout(function() {
 *   SPECTRA.cache.get('exp2', 50); // null since expired
 * }, 100);
**/
  function get(names, maxage, ts, storage) {
    storage = NormalizeStorage(storage);
    maxage = NormalizeMaxAge(maxage);
    ts = NormalizeTS(ts);

    var single = (typeof names) === 'string';
    if (single) {
      names = [names];
    }
    var results = names.reduce(function(tgt, name) {
      var prefixedName = prefix + name;
      var record = storage.getItem(prefixedName);
      try {
        record = JSON.parse(record);
        if (record && record.t && ((ts - record.t) < maxage)) {
          tgt[name] = record.v;
        } else {
          storage.removeItem(prefixedName);
        }
      } catch(e) {
        storage.removeItem(prefixedName);
      }
      return tgt;
    }, {});
    return single? results[names[0]]: results;
  }
/**
 * @method set
 * @instance
 * @memberof SPECTRA.cache
 * @param {string|Map<string, *>}              hashOrName  Name of item to set or objects to set
 * @param {*|number}                           valueOrTs   Value to set (if hashOrName is not a hash). Timestamp otherwise
 * @param {number|SPECTRA.cache.ICacheStorage} tsOrStorage Timestamp to register (if hashOrName is not a hash). Timestamp otherwise
 * @param {SPECTRA.cache.ICacheStorage}        storage     storage (if hashOrName is not a hash).
 * @returns {*|Map<string,*>} value of items
 * @example
 * SPECTRA.cache.set('foo', 'bar'); // Sets foo to bar in localStorage with TS= Date.now()
 * SPECTRA.cache.set({foo:'bar'});  // Sets foo to bar in localStorage with TS= Date.now()
 *
 * SPECTRA.cache.set('foo', 'bar', null, sessionStorage); // Sets foo to bar in sessionStorage with TS= Date.now()
 * SPECTRA.cache.set({foo:'bar'}, null,  sessionStorage); // Sets foo to bar in sessionStorage with TS= Date.now()
**/
  function set(hashOrName, valueOrTs, tsOrStorage, storage) {
    var hash, ts;
    if (typeof hashOrName === 'object') {
      hash = hashOrName;
      ts = valueOrTs;
      storage = tsOrStorage;
    } else {
      hash = {};
      hash[hashOrName] = valueOrTs;
      ts = tsOrStorage;
    }
    storage = NormalizeStorage(storage);
    ts = NormalizeTS(ts);
    var record = {
      t: ts
    };

    for (var key in hash) {
      var
        value = hash[key],
        name = prefix + key;
      if (value == null) {
        storage.removeItem(name);
      } else {
        record.v = value;
        try {
          storage.setItem(name, JSON.stringify(record));
        } catch(e){
        }
      }
    }
  }
/**
 * @method update
 * @instance
 * @memberof SPECTRA.cache
 * @param {string|Array<string>}        names     Name or names of items to update
 * @param {updater}                     updater   Function which will update missing items
 * @param {number}                      [maxage]  Maximum cache age for entries
 * @param {number}                      [ts]      Timestamp to test cache against
 * @param {SPECTRA.cache.ICacheStorage} [storage] Storage in which to look for entries
 * @returns {*|Map<string,*>} value of items
 * @example
 * SPECTRA.cache.update('foo', function(keys) {
 *   return keys.map()
 * }).then(function(v) {
 *   console.log(v);
 * });
 * SPECTRA.cache.get('foo'); // 'bar'
 *
 * SPECTRA.cache.set('exp', 'gone', 500); // As if set at TS 500
 * SPECTRA.cache.get('foo', 50, 600 ); // null, since we don't want older than 50ms
 *
 * SPECTRA.cache.set('exp2', 'set');
 * setTimeout(function() {
 *   SPECTRA.cache.get('exp2', 50); // null since expired
 * }, 100);
**/
  function update(names_, updater, maxage, ts, storage) {
    storage = NormalizeStorage(storage);
    ts = NormalizeTS(ts);
    maxage = NormalizeMaxAge(maxage);

    var
      single = isSingle(names_),
      names = single? [names_]: names_,
      cached = get(names, maxage, ts, storage),
      cachedNames = cached? Object.keys(cached):[],
      namesToUpdate = names.filter(function(key) {
        return cachedNames.indexOf(key) === -1;
      });
    return (namesToUpdate.length && libutils.isF(updater))?
      libutils.when(updater(namesToUpdate)).then(function(results) {
        set(results, Date.now(), storage);
        for (var k in cached) {
          results[k] = cached[k];
        }
        return results;
      }): libutils.when(cached);
  }
  /**
   * @method clear
   * @instance
   * @memberof SPECTRA.cache
   * @param {number}                      [maxage]  Maximum cache age for entries
   * @param {number}                      [ts]      Timestamp to test cache against
   * @param {SPECTRA.cache.ICacheStorage} [storage] Storage in which to look for entries
   * @example
   * // Clear data from cache which is older than 24 hours
   * SPECTRA.cache.clear(1000 * 60 * 60 * 24);
   *
  **/
  function doclear(maxage, ts, storage, startsWith) {
    storage = NormalizeStorage(storage);
    maxage = NormalizeMaxAge(maxage);
    ts = NormalizeTS(ts);
    var results = Object.keys(storage)
      .filter(function(v) {
        return v.startsWith(startsWith);
      }).forEach(function(name) {
        var record = storage.getItem(name);
        try {
          record = JSON.parse(record);
          if (record && record.t && ((ts - record.t) > maxage)) {
            storage.removeItem(name);
          }
        } catch(e) {
        }
      });
  }
  function clear(maxage, ts, storage, startsWith) {
    return doclear(maxage, ts, storage, BASE_PREFIX);
  }

  API = SPECTRA.utils.RO({}, {
    get: get,
    set: set,
    update: update,
    clear: clear
  });
  Object.defineProperties(API, {
    defaultStorage: {
      enumerable: true,
      get: function() {
        return defaultStorage;
      }, set: function(storage) {
        // Try the interface
        storage.getItem('');
        storage.setItem('', '');
        storage.removeItem('');
        defaultStorage = storage;
      }
    },
    defaultMaxAge: {
      enumerable: true,
      get: function() {
        return defaultMaxAge;
      },
      set: function(maxage) {
        if (maxage === null) {
          maxage = DEFAULT_MAX_AGE;
        }
        if (!isNaN(maxage)) {
          defaultMaxAge = maxage;
        }
      }
    },
    context: {
      enumerable: true,
      get: function() {
        return context;
      },
      set: function(ctx) {
        doclear(-1, null, null, DEFAULT_PREFIX);
        context = ctx;
        prefix = BASE_PREFIX + context + '.';
      }
    }
  });
  return API;
})();

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
  (function(global, SPECTRA) {
  var
    FORCE_LOCAL_ROUTERS = true, // Until libpubsubserver is intergrated in multiplayer
    liblog = global.liblog,
    config = SPECTRA.staticConfig;

  function makeRouter(exchange) {
    var router = new libpubsub.FSRouter(exchange);
    router.onerror = function(why) {
      liblog('spectra.dev').warn('Could not connect to pubsub', exchange);
    };
    router.onclose = function(why) {
      liblog('spectra.dev').warn('pubsub router closed', exchange);
    };
  }
  if (SPECTRA.impl.mode === 'player' || config.devmode) {
    liblog.dev = config.devmode; // pipe warnings and errors to console
    if (FORCE_LOCAL_ROUTERS || (global.parent === global)) {
      makeRouter();
      makeRouter('log');
      makeRouter('system');
    }
  }
})(this, SPECTRA);

/**
 * @license
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

/**
 * @file
 * Customer-facing interface for SPECTRA communication service
 * {@link AssetsService}
**/

  /*
   *  Assets manager.
   */

   /**
    * AssetsManager singleton interface
    * @class AssetsManager
    * @inner AssetsService
   **/

  /**
   * @typedef AssetsManager.Playtime
   * @property {string}                       type        Schedule type 'data', 'kiosk', 'sign'. Default: 'data'.
   * @property {RFC3339}                      syncstart  Original entry start date, before playtime merge
   * @property {RFC3339}                      start      Start date
   * @property {RFC3339}                      end        End date
   * @property {AssetsManager.ScheduleEntry}  entry      Schedule entry
   */

  /**
   * Query playtimes (all schedule entries merged).
   * @memberof AssetsManager
   * @method getPlaytimes
   * @instance
   * @param {AssetsManager.ScheduleQuery} params Playtimes are cached, so it is a good idea to always use the same shifting time window
   * @returns {Array.<AssetsManager.Playtime>}
   */

  /**
   * Get the current playtime (currently scheduled entry)
   * @memberof AssetsManager
   * @method currentPlaytime
   * @instance
   * @param {AssetsManager.ScheduleQuery} params Playtimes are cached, so it is a good idea to always use the same shifting time window
   * @returns {AssetsManager.Playtime}
   */

  /**
   * Get next scheduled entry
   * @memberof AssetsManager
   * @method nextPlaytime
   * @instance
   * @param {AssetsManager.ScheduleQuery} params Playtimes are cached, so it is a good idea to always use the same shifting time window
   * @returns {AssetsManager.Playtime}
   */

  /**
   * Asset type: 'content', 'playlist', 'set'
   * @typedef {string} AssetsManager.AssetType
   *
  **/

  /**
   * @typedef AssetsManager.AssetQuery
   * @property {string=} [name]  Exact name of the asset(s). Optional.
   * @property {string=} [ename] Unix-like wildcard asset name (case-sensitive). Optional.
   * @property {AssetsManager.AssetType=} [type]
   * @property {string=} [mediatype] Media type (for type==contents): video, html, ...
   * @property {number=} [uid]   Unique ID on this player
   * @property {number=} [cmid]  ID, as provided by CM (unique when a single CM is used).
   * @property {number=} [limit]   For paginated queries. Optional.
   * @property {number=} [offset]  For paginated queries. Optional.
  */
  /**
   * @typedef AssetsManager.DateRange
   * @property {RFC3339} startdate Start date of range
   * @property {RFC3339} enddate   End date of range
  **/

  /**
    Response to an asset query
   * @typedef AssetsManager.AssetDescriptor
   * @property {number} uid     Unique asset ID on this player
   * @property {string} type    Asset type (content, playlist, set);
   * @property {number} cmid    CM asset ID (prefer to use uid for really unique ID on the player).
   * @property {number} mediaid Media ID from CM (mostly useless).
   * @property {string} mediatype Media type (video, smil, ...)
   * @property {string} name Asset name
   * @property {string} file Filename
   * @property {number=} [duration] Asset duration
   * @property {number} size File size
   * @property {AssetsManager.DateRange=} [lifecycle]  Only when lifecycle data is available
   * @property {AssetsManager.DateRange=} [schedule] When schedule is available. Define the period within which the asset is schedule. for detailed schedules, use getSchedules() method.
  */

  /**
    Response from an asset query.
   * @typedef {Object.<number, AssetsManager.AssetDescriptor>} AssetsManager.AssetQueryResponse
  **/

  /**
   * @typedef AssetsManager.ContainerAssetQuery
   * @property {(Object<number,AssetsManager.AssetQuery>|{id:number})}
   */

  /**
   * List assets from a given container (recursively within sub-containers).
   * @memberof AssetsManager
   * @method getAssetsFromContainer
   * @instance
   * @param {AssetsManager.ContainerAssetQuery} params
   * @returns {AssetsManager.AssetQueryResponse}
   */

  /**
   * List assets currently on the player.
   * @memberof AssetsManager
   * @method getAssets
   * @instance
   * @param {AssetsManager.AssetQuery} params Query parameters
   * @returns {AssetsManager.AssetQueryResponse}
   */

  /**
     * Schedule Query parameters
     * @typedef AssetsManager.ScheduleQuery
     * @property {RFC3339=}  [time]           Only used for currentPlayTime / nextPlaytime
     * @property {number}   playerid          Player ID to get playtimes for.
     * @property {string=}  [type]            Schedule type 'data', 'kiosk', 'sign'. Default: 'data'.
     * @property {Standards.ISO8601=} [start] Start date/time. Default: 1h ago.
     * @property {number=} [period]           Period in seconds. Default: 24h.
     */
    /**
     * Schedule period
     * @typedef AssetsManager.SchedulePeriod
     * @property {Standards.RFC3339} start  Start date
     * @property {Standards.RFC3339} end    End date
     */
    /**
     * @typedef AssetsManager.ScheduleEntry
     * @property {number} uid Unique schedule entry (be careful: one entry can appear several times in the array in case of recurrence).
     * @property {number} fragmentid  fragment ID (from CM)
     * @property {number} playerid    Logical player id.
     * @property {number} entryid     Entry ID (within the schedule fragment file)
     * @property {string=} [name]     Schedule name (not always set).
     * @property {string=} [description] Schedule description (not always set either).
     * @property {boolean} default     True when this is a default schedule.
     * @property {AssetsManager.SchedulePeriod} schedule
     * @property {AssetsManager.AssetDescriptor} asset
     * @property {MinMax} priority Min/Max priority
     */
    /**
     * Query schedules, exploded with recurrences, but not merged as playtimes. Returns {@link Array<AssetsManager.ScheduleEntry>}
     * @memberof AssetsManager
     * @method getSchedules
     * @instance
     * @param {AssetsManager.ScheduleQuery} params
     * @returns {Array<AssetsManager.ScheduleEntry>}
     */

(function(SPECTRA) {
  var
    slog = SPECTRA.log('spectra.assets'),
    spectraUtils = SPECTRA.utils,
    RO = spectraUtils.RO,
    impl_assets,
    impl_promise = SPECTRA.Promise.Deferred(),
    playerID,
    ready = spectraUtils.once(function() {
      return SPECTRA.initmsg.then(function() {
        playerID = SPECTRA.playerId();
        return impl_promise;
      });
    });

  function SetImpl(impl) {
    impl_assets = impl.assetsmgr();
    delete SPECTRA._assets;
    impl_promise.resolve(impl_assets);
  }

  function remoteCall(name, params, addDefaultID) {
    return ready().then(function() {
      if (impl_assets === undefined) {
        throw new Error('no implementation');
      }
      if (typeof params !== 'object') {
        throw new Error('invalid query');
      }
      if (addDefaultID && params.playerid === undefined) {
        params.playerid = playerid;
      }
      return impl_assets.remote_call(name, params);
    });
  }

  var remotes = [
    ['getAssets',               false],
    ['getAssetsFromContainer',  false],
    ['getSchedules',            true],
    ['getPlaytimes',            true],
    ['currentPlaytime',         true],
    ['nextPlaytime',            true],
  ].map(function(conf) {
    var name = conf[0], add = conf[1];
    return function(params) {
      return remoteCall(name, params, add);
    };
  });

  function assetPath(src) {
    try {
      return impl_assets.assetPath(src);
    } catch(e) {
      slog.error('Called assetPath too soon', e);
    }
  }

  var iface = {
    log:    slog,
    ready:  ready,
    root:   assetPath,
    assets: RO({}, {
      get:    remotes[0], // getAssets
      from:   remotes[1], // getAssetsFromContainer
    }),
    schedules: RO({}, {
      get:    remotes[2], // getSchedules
    }),
    playtimes: RO({}, {
      get:    remotes[3], // getPlaytimes
      curr:   remotes[4], // currentPlaytime
      next:   remotes[5]  // nextPlaytime
    })
  };

  SPECTRA._assets = {
    SetImpl: SetImpl
  };

  Object.defineProperty(iface, 'impl', {
    get: function() {
      return impl_assets;
    }
  });
  // TODO: set to read-only once we remove spectra.legacy.jquery.js
  // and spectra.legacy.js
  SPECTRA.assets = iface;
})(SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
// Spectra Business Intelligence module.
// Actually: remote logger.
(function(window, SPECTRA) {
//  "use strict";
  // Accelerators
  var
    liblog = window.liblog,
    STR_REMOTE             = 'remote',
    LOG_CHANNEL            = 'spectra.bi',
    AFFIDAVIT_CHANNEL_NAME = 'affidavit',
    AFFIDAVIT_VALIDATION   = 'Affidavit validation',
    BI_CHANNEL_NAME        = 'bi',
    DEFAULT_AFFIDAVIT = {
      eventName:    undefined,
      extraData:    0,
      playerIndex:  0, // Depends on SPECTRA.initmsg
      regionName:   '',
      resourceName: undefined,
    },
    DEFAULT_AFFIDAVIT_STR = JSON.stringify(DEFAULT_AFFIDAVIT),
    AFFIDAVIT_MEMBERS = Object.keys(DEFAULT_AFFIDAVIT),
    spectraUtils  = SPECTRA.utils,
    RO            = spectraUtils.RO,
    eachprop      = spectraUtils.eachprop,
    slog          = liblog(LOG_CHANNEL),
    SPECTRAPromise = SPECTRA.Promise,
    readyPromise = SPECTRA.initmsg.then(function() {
      DEFAULT_AFFIDAVIT.playerIndex = SPECTRA.playerId();
      DEFAULT_AFFIDAVIT_STR = JSON.stringify(DEFAULT_AFFIDAVIT);
    }),
    implPromise = $.Deferred(),
    ready = spectraUtils.once(function() {
      return readyPromise;
    });

  function SetImpl(impl) {
    implPromise.resolve(impl);
    delete SPECTRA.bi_;
  }

  function TransportProxy(name, create, otherlogger) {
    var
      self = this,
      queue = [],
      createTask,
      transport;
    function send(channel, level, msg) {
      if (transport) {
        transport.send({
          loggerId: channel,
          logLevel: level,
          message:  msg
        });
      } else if (queue) {
        queue.push([channel, level, msg]);
        if(!createTask) {
          createTask = new SPECTRAPromise(create);
          createTask.then(function(t) {
            transport = t;
            queue.forEach(function(v) {
              send.apply(self, v);
            });
            transport = t;
            queue = null;
          }).catch(function(why) {
            slog.error(name, why);
            liblog(otherlogger).error(name, why);
          });
        }
      }
    }
    self.send = send;
  }
  var proxies = {};
  function getPubSub() {
    if (!proxies.pubsub) {
      proxies.pubsub = new TransportProxy('pubsub', function(resolve, reject) {
        var transport = new libpubsub.FSClient('log');
        transport.send = function(payload) {
          var pubsubChannel;
          if (payload.loggerId === AFFIDAVIT_CHANNEL_NAME) {
            pubsubChannel = 'aff';
          } else {
            pubsubChannel = ['log', payload.logLevel, payload.loggerId].join('.');
          }
          return this.publish(pubsubChannel, payload);
        };
        transport.onopen = function() {
          resolve(transport);
        };
        transport.onerror = reject;
        transport.onclose = function() {
          slog.warn(STR_REMOTE + ' via libpubsub closed');
        };
        transport.connect();
      }, 'spectra.bi.legacy');
    }
    return proxies.pubsub;
  }
  function getLegacy() {
    if (SPECTRA.staticConfig.legacyBI && !proxies.legacy) {
      var watcher = {
        onclose: function() {
          delete proxies.legacy;
        }
      };

      proxies.legacy = new TransportProxy('legacyImpl', function(resolve, reject) {
        implPromise.then(function(impl) {
          impl.setLogger(slog);
          return libutils.when(impl.open(watcher)).then(function() {
            resolve(impl);
          });
        }).fail(reject);
      }, 'spectra.bi.pubsub');
    }
    return proxies.legacy;
  }

  function send(channel, level, msg) {
    getPubSub().send(channel, level, msg);
    var legacy = getLegacy();
    if(legacy) legacy.send(channel, level, msg);
  }

  function _validateAffidavit(affidavit) {
    if (typeof affidavit !== 'object') {
      slog.error(AFFIDAVIT_VALIDATION, 'not an object', affidavit);
      return;
    }

    // check that no member is 'undefined'
    var superfluous_members = [];
    eachprop(affidavit, function(name, value) {
      if (AFFIDAVIT_MEMBERS.indexOf(name) === -1) {
        superfluous_members.push(name);
      }
    });

    if (superfluous_members.length !== 0) {
      slog.warn(AFFIDAVIT_VALIDATION, 'superfluous', superfluous_members);
    }

    var missingMembers = [];
    AFFIDAVIT_MEMBERS.forEach(function(name) {
      if (affidavit[name] === undefined) {
        missingMembers.push(name);
      }
    });

    if (missingMembers.length !== 0) {
      slog.warn(AFFIDAVIT_VALIDATION, 'missing members', missingMembers);
    }
    return affidavit;
  }

  //////////////////////////////////////////////////////////////////////////////////
  //
  // BEGIN BI SINK
  //
  //
  (function() {
    var handler = RO({}, {
      handle: function(context) {
        var msg,
          channel = context.channel,
          args    = context.args,
          level   = context.level.toUpperCase();
        if (LOG_CHANNEL === channel) {
          // If LOG_CHANNEL is bound to 'remote' sink, any logging to LOG_CHANNEL after this point will
          // call this function recursively. We prevent this by blocking at this level.
          // The call to excludeSinksFromChannels
          console.error('Potential stack overflow detected. Not sending message');
          return;
        }
        if (channel === AFFIDAVIT_CHANNEL_NAME) {
          level = 'INFO';
          if (args.length !== 1) {
            slog.error(AFFIDAVIT_VALIDATION, 'expected 1 arg', args.length);
            return;
          }
          msg = _validateAffidavit(args[0]);
          if (msg !== undefined ) {
            msg = JSON.stringify(msg); // affidavit requires msg to be stringified.
          }
        } else {
          msg = context.stringify();
        }
        if (msg !== undefined) {
          send(channel, level, msg);
        }
      }
    });

    liblog
      .sinks.add(handler, STR_REMOTE, LOG_CHANNEL)
      .nopipe(LOG_CHANNEL, STR_REMOTE)
      .pipe([BI_CHANNEL_NAME, AFFIDAVIT_CHANNEL_NAME], STR_REMOTE);
  })();
  //
  //
  // END BI SINK
  //
  //////////////////////////////////////////////////////////////////////////////////

  var affidavit_singleton = (function() {
    var logger = liblog(AFFIDAVIT_CHANNEL_NAME);
    function post(affidavit) {
      return ready().then(function() {
        var
          result = false,
          newAffidavit = JSON.parse(DEFAULT_AFFIDAVIT_STR);
        for (var k in affidavit) {
          newAffidavit[k] = affidavit[k];
        }
        affidavit = _validateAffidavit(newAffidavit);
        result = affidavit !== undefined;
        if (result) {
          logger.log(affidavit);
        }
        return result;
      });
    }
    function makeAffidavit(evt, extra, player, region, resource) {
      return {
        eventName:    evt,
        extraData:    extra || 0,
        playerIndex:  player || DEFAULT_AFFIDAVIT.playerIndex,
        regionName:   region || 'None',
        resourceName: resource
      };
    }
    function defaultPost(evt) {
      return function(params) {
        params = params ||{};
        return post(makeAffidavit(evt, params.pos, params.player, params.region, params.id));
      };
    }
    return RO({}, {
      play: defaultPost('STATE_PLAYING'),
      stop: defaultPost('STATE_STOPPED'),
      pause: defaultPost('STATE_PAUSED'),
      startpl: function(params) {
        return post(makeAffidavit('STATE_PL_START', params.scid, params.player, params.region, params.plid));
      },
      stoppl: function(params) {
        return post(makeAffidavit('STATE_PL_STOP', 0, params.player, params.region, params.plid));
      },
      error: function(params) {
        return post(makeAffidavit('STATE_ERROR', params.player, params.region, params,id, params.code));
      }
    });
  })();

  SPECTRA.bi_ = {
    SetImpl: SetImpl
  };

  RO(SPECTRA, {
    bi: RO({}, {
      getAffidavitLogger: function() {
        return affidavit_singleton;
      },
      getRemoteLogger: function() {
        return liblog('bi');
      },
      ready: ready
    })
  });
})(this, SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

/*
 *  Spectra data API.
 */
(function(context, SPECTRA) {
  "use strict";

  var
    STR_DATA = 'spectra.data',
    STR_IMPL = STR_DATA + '.impl',
    log = SPECTRA.log(STR_DATA),
    cache = SPECTRA.cache,
    libutils = context.libutils,
    RO = libutils.RO,
    implPromise = SPECTRA.Promise.Deferred(),
    ready = libutils.PromiseOnce(function() {
      return implPromise;
    });

  function SetImpl(impl) {
    implPromise.resolve(impl);
    delete SPECTRA._data;
  }

  function KeyToString(key, name) {
    return [key.db, key.table, key.colval, key.colname, name].join('!');
  }

  function isSingle(val) {
    var
      to = typeof val,
      io = ['string', 'number'].indexOf(to),
      is = io !== -1;
    return is;
  }

  function Update(keys_, singleClosure, multiClosure, maxage, keyMap, prefix, internalKey) {
    var
      single = isSingle(keys_),
      keys = single? [keys_]: keys_,
      cacheKeys = prefix? keys.map(function(key) {
        return prefix + key;
      }): keys;
    function doUpdate(keys) {
      var origKeys = keyMap? keys.map(function(key) {
        return keyMap[key];
      }): keys,
      single = (origKeys.length === 1),
      firstKey = origKeys[0],
      task = libutils.when(single?
        singleClosure(firstKey, internalKey).then(function(rawResult) {
          var result = {};
          result[firstKey] = rawResult;
          return result;
        }):
        multiClosure(origKeys, internalKey));
      return task.then(function(result) {
        if (!prefix) {
          return result;
        }
        var r2 = {};
        for (var k in result) {
          r2[prefix + k] = result[k];
        }
        return r2;
      });
    }
    return cache.update(cacheKeys, doUpdate, maxage).then(function(values) {
      var result = values;
      if (keyMap) {
        // Only DB queries have a keymap
        result = {};
        for (var k in values) {
          result[keyMap[k]] = values[k];
        }
      } else {
        // AVP2551 convert single-item array results to string
        // This else assumes that only properties send a keyMap
        for (var key in values) {
          var value = values[key];
          if (Array.isArray(value) && value.length === 1) {
            values[key] = value[0];
          }
        }
      }
      return single? result[keys_]: result;
    });
  }

  var pipes = ['getDBProperty', 'getDBProperties', 'getProperty', 'getProperties']
    .map(function(v) {
      return function(a,b) {
        return ready().then(function(impl) {
          return impl[v].call(impl, a, b);
        });
      };
    });

  function QueryDB(db, table, colname, colval, names_, maxage) {
    var
      single = isSingle(names_),
      names = single? [names_]: names_,
      dbkey = {
        db: db,
        table: table,
        colval: colval,
        colname: colname
      },
      baseKey = KeyToString(dbkey, ''),
      keys=[],
      keyMap = names.reduce(function(tgt, v) {
        var cacheKey = baseKey + v;
        tgt[cacheKey] = v;
        keys.push(cacheKey);
        return tgt;
      }, {});
    return Update(names_, pipes[0], pipes[1], maxage, keyMap, baseKey, dbkey).then(function(result) {
      return result;
    });
  }

  function QueryProps(keys_, maxage) {
    return Update(keys_, pipes[2], pipes[3], maxage);
  }

  /*
   * Get a list of properties using a key globber.
   *   ns:   properties namespace (tags)
   *   ekey: property key glob (with unix-like wildcards).
   * Return a promise: done(propsCache) or fail(error).
   * TODO: cache results and only update once we get tag change notifications
   */
  function queryProperties(ns, ekey, timeout) {
    return ready().then(function(impl) {
      return impl.queryProperties(ns, ekey).then(function(allprops) {
        var props = {};
        for (var ns in allprops) {
          var nsprops = allprops[ns];
          for (var key in nsprops) {
            props[ns + '.' + key] = nsprops[key].values;
          }
        }
        cache.set(props);
        return props;
      });
    });
  }

  // Internal bindings
  SPECTRA._data = {
    SetImpl: SetImpl
  };

  // TODO: RO(SPECTRA.data, read-only
  SPECTRA.data = RO({}, {
    db: RO({
      get: QueryDB
    }),
    props: RO({
      get:   QueryProps,
      query: queryProperties
    }),
    ready: ready,
    log: log
  });

})(this, SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function(SPECTRA) {
  var
    libpubsub = window.libpubsub,
    libutils = window.libutils,
    libframesocket = window.libframesocket,
    STR_ONCLOSE = 'onclose',
    STR_ONOPEN  = 'onopen',
    STR_ONERROR = 'onerror',
    STR_PUBSUBBASE = 'av.sapi.comm',
    STR_SUBSCRIBE = 'subscribe',
    STR_ONMESSAGE = 'onmessage',
    STR_UNSUBSCRIBE = 'un' + STR_SUBSCRIBE,
    STR_SUBSCRIBE_PRESENCE = STR_SUBSCRIBE + 'Presence',
    STR_UNSUBSCRIBE_PRESENCE = STR_UNSUBSCRIBE + 'Presence',
    CONST_PUBSUBBASE_LEN_PLUS_ONE = STR_PUBSUBBASE.length + 1,
    SUPPORT_LEGACY_LISTENERS = true,
    RO = SPECTRA.utils.RO,
    ready = function() {
      return libutils.Promise.resolve();
    },
    log = SPECTRA.log('spectra.comm');

  var Client = (function() {
    function topicToChannel(topic) {
      return topic.substr(CONST_PUBSUBBASE_LEN_PLUS_ONE);
    }
    function Client(config) {
      var
        self = this,
        configID = config.id,
        configChannel = config.channel,
        configLobby = libutils.defv(config.lobby,true),
        configSnoop = libutils.defv(config.lobby,false),
        parentPubSubTopic = [STR_PUBSUBBASE, configChannel].join('.'),
        pubSubClient,
        pubSubTopic       = [parentPubSubTopic, configID].join('.'),
        presenceTopic     = parentPubSubTopic + '.*',
        lobby = [],
        legacyLobbyQueue = [],
        lobbyQueue = [],
        listeners = [];

      if (config.wsURL) {
        pubSubClient = new libpubsub.Client(null, new WebSocket(config.wsURL));
      } else {
        pubSubClient = new libpubsub.FSClient();
      }

      var default_header = {
        from    : undefined,
        to      : undefined,
        channel : undefined
      };

      function notify(str, arg) {
        if (self[str]) {
          self[str].call(self, arg);
        }
      }
      function onmessage(payload) {
        var
          pl = payload.body,
          body = pl[0],
          topic = payload.topic,
          from = pl[1],
          to = topic.substr(parentPubSubTopic.length + 1);

        if (SUPPORT_LEGACY_LISTENERS) {
          var legacyPayload = {
            hdr: {
              type: 'CHBC',
              to: to,
              from: from,
              channel: configChannel,
            },
            data: body
          };

          listeners.forEach(function(closure) {
            closure.call(self, legacyPayload);
          });
        }
        var closurePayload = {
          to:       to,
          from:     from,
          data:     body,
          channel:  configChannel,
          ts:       payload.ts
        };

        notify(STR_ONMESSAGE, closurePayload);
      }

      function onlobby(payload) {
        var
          body = payload.body,
          topic = body.client || '',
          isResponseToLobby = topic === '',
          parentTopicLenPlusOne = parentPubSubTopic.length + 1,
          clientID = topic.substr(parentTopicLenPlusOne),
          clients = body.lobby.map(function(client) {
            return client.substr(parentTopicLenPlusOne);
          }),
          lastLobbyCopy = JSON.parse(JSON.stringify(lobby)),
          clientDiff = clients.filter(function(clientID) {
            var
              indexInList = lastLobbyCopy.indexOf(clientID),
              known = indexInList !== -1;
            if (known) {
              lastLobbyCopy.splice(indexInList, 1);
            }
            return !known;
          });

        if (!isResponseToLobby && payload.isme) {
          try {
            notify(body.active? STR_ONOPEN: STR_ONCLOSE);
          } catch(e) {
            log.error(e);
          }
        }

        if (configLobby) {
          lobby = clients;
          var isConnecting = this.socket.readyState === this.socket.CONNECTING;
          if (SUPPORT_LEGACY_LISTENERS && (listeners.length || isConnecting)) {
            var legacyPayloads = clientDiff.map(function(clientID) {
              return {
                hdr: {
                  type: 'CHAD',
                  from: clientID,
                  to: configID,
                  channel: configChannel,
                },
                lobby: clients,
              };
            }).concat(lastLobbyCopy.map(function(clientID) {
              return {
                hdr: {
                  type: 'CHRM',
                  from: clientID,
                  to: configID,
                  channel: configChannel,
                },
                lobby: clients
              };
            })).forEach(function(payload) {
              if (isConnecting) {
                legacyLobbyQueue.push(payload);
              } else {
                listeners.forEach(function(closure) {
                  closure.call(self, payload);
                });
              }
            });
          }

          // New closure
          var lobbyEvent = {
            presence: true,
            id:       clientID,
            join:     body.active,
            channel:  configChannel,
            lobby:    clients,
            joined:   clientDiff,
            left:     lastLobbyCopy,
            isme:     payload.isme,
          };

          if (self.onlobby) {
            self.onlobby(lobbyEvent);
          } else if (isConnecting) {
            lobbyQueue.push(lobbyEvent);
          }
        }
      }

      function send(message, recipient) {
        var target = [parentPubSubTopic, (recipient || '*')].join('.');
        pubSubClient.publish(target, [message, configID], pubSubTopic);
      }

      function chainError(name) {
        pubSubClient[name] = function(e) {
          lobby = [];
          legacyLobbyQueue = [];
          lobbyQueue = [];
          return notify(name, e);
        };
      }
      chainError(STR_ONERROR);
      chainError(STR_ONCLOSE);

      function listen(closure) {
        if (SUPPORT_LEGACY_LISTENERS) {
          listeners.push(closure);
        } else {
          SPECTRA.deprecation.once('soon', 'spectra.comm.listen');
        }
      }

      function subscribe() {
        pubSubClient[STR_SUBSCRIBE_PRESENCE](presenceTopic, onlobby);
        pubSubClient[STR_SUBSCRIBE](pubSubTopic, onmessage);
        if (configSnoop) {
          pubSubClient[STR_SUBSCRIBE](presenceTopic, onmessage);
        }
      }
      function close() {
        pubSubClient.close();
      }
      RO(self, {
        id:       configID,
        channel:  configChannel,
        close:    close,
        send:     send,
        listen:   listen,
      });

      pubSubClient[STR_ONOPEN] = function() {
        try {
          subscribe();
          notify(STR_ONOPEN);
          // call pending
          if (listeners.length) {
            legacyLobbyQueue.forEach(function(legacyPayload) {
              listeners.forEach(function(closure) {
                listeners.forEach(function(closure) {
                  closure.call(self, legacyPayload);
                });
              });
            });
          } else if (self.onlobby) {
            lobbyQueue.forEach(function(event) {
              self.onlobby(event);
            });
          }
          legacyLobbyQueue = [];
          lobbyQueue = [];
        } catch(e) {
          log.error(e);
        }
      };
      pubSubClient.connect();
    }
    return Client;
  })();

  SPECTRA.comm = {
    ready: ready,
    Client: Client
  };

})(SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function(SPECTRA) {
  "use strict";
  /*
   * AssetsMgr implementation for S-200
   */

  var
    $when = $.when,
    RO = SPECTRA.utils.RO,
    avassets = avInterface('assets'),
    impl_assets = RO({}, {
      remote_call : function(func, params) {
        var deferred = libutils.Promise.Deferred();
        avassets.jsonProcess(func, params || {}, function(status, result) {
          if (result === undefined && status.error !== undefined) {
            deferred.reject(status.error);
          } else {
            deferred.resolve(result);
          }
        });
        return deferred.promise();
      },
      assetPath: function(src) {
        return '/Contents/' + src;
      }
    }),
    impl = RO({}, {
      assetsmgr: function() {
        return impl_assets;
      }
    });
  SPECTRA._assets.SetImpl(impl);
})(SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function() {
  "use strict";
  var
    transport_protocol = (window.location.protocol.toLowerCase() === 'http:') ? 'ws://' : 'wss://',
    _url = transport_protocol + window.location.hostname + ':9000/websocket/logger',
    _socket,
    _logger; // will be set by parent

  function _setLogger(logger) {
    _logger = logger;
  }
  function _close() {
    if (_socket !== undefined) {
      _socket.close();
      _socket = undefined;
    }
  }
  function _open(watcher) {
    var task = libutils.Promise.Deferred();
    _close();
    _logger.log('Connecting to ' + _url);
    _socket = new WebSocket(_url);
    _socket.onopen = function() {
      _logger.log('Socket is open: ' + _url);
      task.resolve();
    };
    _socket.onerror = function(e) {
      _logger.error('Socket error', _url, e);
      task.fail(e.data);
    };
    _socket.onmessage = function(payload){
      _logger.error('Unexpected message', _url, payload);
    };
    _socket.onclose = function() {
    _logger.log('Socket is closed: ' + _url);
      if (watcher !== undefined && watcher.onclose !== undefined) {
        watcher.onclose();
      }
      if (task.state() === 'pending') {
        task.reject('Socket closed before connecting'+_url );
      }
    };
    return task.promise();
  }

  function _send(message) {
    var str = JSON.stringify(message);
    if (_socket !== undefined && _socket.readyState === WebSocket.OPEN) {
      _logger.debug('sending', str);
      _socket.send(str);
    } else {
      _logger.warn('[logger closed, log dropped] ', str);
    }
  }
  SPECTRA.bi_.SetImpl({
    open: _open,
    send: _send,
    setLogger : _setLogger,
  });
})(window);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
  (function(global, SPECTRA) {
  var
    libutils = global.libutils,
    RO = libutils.RO,
    avprops = avInterface('properties'),
    anydb = avInterface('anydb'),
    Deferred = libutils.Promise.Deferred;

  function scalarOrArray(value) {
    if (value != null) {
      if (Array.isArray(value) && value.length === 1) {
        return value[0];
      }
    }
    return value;
  }

  function makePropsDeferred(name, default_) {
    return function(args, arg2) {
      var task = new Deferred();
      if (name === 'queryProperties') {
        args = {
          ns: args,
          ekey: arg2
        };
      }
      avprops[name].call(avprops, args, function(p, r) {
        if ((r === undefined) && p.error !== undefined) {
          task.reject(p.error);
        } else {
          task.resolve((r === undefined)? default_: r);
        }
      });
      return task.promise();
    };
  }
  var API = RO({}, {
    // Load a property from the player.
    //   name: property name to load. (eg: "tags.myTag").
    // Return promise: done(value) or fail(error)
    //   value: value string or array of value strings.
    //   error: error message
    getProperty: makePropsDeferred('getProperty', ''),
    // This function performs a single JSON request to retrieve all the properties at once.
    //   names: array of property names to load. (eg: "tags.myTag").
    // Return promise: done({<name>: <value>}) or fail(<error>)
    //   name:  property name
    //   value: value string or array of value strings.
    //   error: error message
    getProperties: makePropsDeferred('getProperties'),
    // This function performs a single JSON request to find properties globbing a name pattern.
    // args: {
    //   ns:   properties namespace (eg: "tags"). No wildcard allowed, can be omitted.
    //   ekey: property name pattern. (eg: "MyPrefix_*").
    // }
    // Note: the S-200 accepts more parameters to query the tags:
    //   key: property key without wildcard.
    //   flags: comma-separated list of flags:
    //          public/private, local/remote/override/all, staged/applied, static/dynamic.
    // Return promise: done({ <ns>: { <key>: { value: <value>, flags: <flags> }}}) or fail(<error>)
    //   <ns>:   Property namspace.
    //   <key>:  property key.
    //   <value>: value string or array of value strings.
    //   <flags>: public/private, local/remote/override
    //   <error>: error message
    queryProperties: makePropsDeferred('queryProperties'),
    // Load a property from a player DB.
    //   key: {
    //     db:      DB to query; sqlite filename, relative to the default DB location on the player.
    //     table:   table to query in the DB.
    //     colname: column name to query in the table.
    //     colval:  column name to get the property value from.
    //   }
    //   name:    property name to query in the col.
    // Return promise: done(value) or fail(error)
    //   value: value string or array of value strings.
    //   error: error message    getDBProperty: function(key, name) {
    getDBProperty: function(name, key) {
      var task = new Deferred();
      anydb.query(key.db, {
        type:   'select',
        sql:    'SELECT "'+key.colval+'" FROM "'+key.table+'" WHERE "'+key.colname+'" == ?',
        params: [ name ]
      }, function(p, r) {
        if (r === undefined) {
          // Error retrieving value. Check p.error
          task.reject(p.error);
        } else {
          var val = scalarOrArray(r);
          task.resolve((val === undefined) ? '' : val);
        }
      });
      return task;
    }, // getDBProperty
    // Load properties from a player DB.
    //   key: {
    //     db:      DB to query; sqlite filename, relative to the default DB location on the player.
    //     table:   table to query in the DB.
    //     colname: column name to query in the table.
    //     colval:  column name to get the property value from.
    //   }
    //   names:   property names to query in the col.
    // Return promise: done({ name: value }) or fail(error)
    //   name:  property name
    //   value: value string or array of value strings.
    //   error: error message
    getDBProperties: function(names, key) {
      var task = new Deferred();
      anydb.query(key.db, {
        type:   'select',
        sql:    'SELECT "'+key.colval+'" FROM "'+key.table+'" WHERE "'+key.colname+'" == ?',
        params: names.map(function(name) { return [ name ]; }) // One select will be executed for each name.
      }, function(p, r) {
        if (r === undefined) {
          // Error retrieving value. Check p.error
          task.reject(p.error);
        } else {
          var hash = {};
          names.forEach(function(name) {
            hash[name] = scalarOrArray(r.shift());
          });
          task.resolve(hash);
        }
      });
      return task.promise();
    } // getDBProperties
  });
  SPECTRA._data.SetImpl(API);
  // Keeping this for backwards compatibility. Todo: remove
  SPECTRA.modules.define('spectra.data.impl', function() {
    return API;
  });
})(this, SPECTRA);

/*
 * (c)2017 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

/**
 * Provides legacy jQuery interfaces
 * @file spectra.legacy.js
 *
**/
(function(global, SPECTRA) {
  var
    STR_spectra = 'spectra',
    STR_assets = 'assets',
    STR_playtimes = 'playtimes',
    STR_dotget = '.get',
    STR_db_get = 'db.get',
    STR_props_get = 'props.get',
    libutils = global.libutils,
    RO = libutils.RO,
    slog = SPECTRA.log(STR_spectra),
    capitalize = libutils.capitalize,
    defineModule = SPECTRA.modules.define,
    deprecateOnce = SPECTRA.deprecation.once,
    PromiseToJQueryDeferred = SPECTRA.utils.P2JQD, // TODO: remove this from SPECTRA.utils
    serviceReadyPromises      = {}; // Service promises.

  // Shortcut to generate rejected promise.
  if (!libutils.isF($.reject)) {
    $.reject = function() {
      var d = $.Deferred();
      return d.reject.apply(d, arguments).promise();
    };
  }

  // define legacy when_initialized
  //
  var LegacyWhenInitialized = (function() {
    var legacyInits = {};
    ['init', 'initmsg', 'loadapiimpl'].forEach(function(stage) {
      legacyInits[stage] = PromiseToJQueryDeferred(SPECTRA[stage]);
    });

    return function(stage) {
      var
        p = legacyInits[stage||'init'],
        err = 'unknown initialization stage "' + stage + '"';
      // returns nothing, for modules dependencies
      return p?$.when(p).then(libutils.noop):(slog.error(err)||$.reject(err));
    };
  })();


  // Add 'ready' and register module
  ['assets'].forEach(function(name) {
    var
      API = SPECTRA[name],
      moduleName = STR_spectra + '.' + name,
      $ready = serviceReadyPromises[name] =
        PromiseToJQueryDeferred(API.ready()).then(function() {
          return API;
        });

    try {
      defineModule(moduleName, [{ready: $ready}], function() {
        return API;
      });
    }catch(e) {
      console.error(name, e);
    }
  });

  // Add 'ready' and register module
  ['assets', 'bi', 'comm', 'data'].forEach(function(name) {
    var
      API = SPECTRA[name],
      moduleName = STR_spectra + '.' + name,
      $ready = serviceReadyPromises[name] =
        PromiseToJQueryDeferred(API.ready()).then(function() {
          return API;
        });

    try {
      defineModule(moduleName, [{ready: $ready}], function() {
        return API;
      });
    }catch(e) {
      console.error(name, e);
    }
  });

  function addLegacyInterface(apiName, list) {
    var
      api = SPECTRA[apiName];
    list.forEach(function(conf) {
      var
        path = conf[0],
        legacyName = conf[1],
        fullPath = 'SPECTRA.' + apiName + '.' + path,
        legacyPath = 'SPECTRA.' + apiName + '.' + legacyName,
        closure = path.split('.').reduce(function(t,n) {
          return t[n];
        }, api);

      if (libutils.isF(api[legacyName])) {
        console.warn(apiName + '.' + legacyName + ' already defined');
      } else {
        api[legacyName] = function() {
          deprecateOnce('moved', legacyPath, fullPath);
          return PromiseToJQueryDeferred(closure.apply(api, arguments));
        };

      }
    });
  }

  addLegacyInterface(STR_assets, [
      [STR_assets + STR_dotget,     'getAssets'],
      [STR_assets + '.from',        'getAssetsFromContainer'],
      ['schedules.get',             'getSchedules'],
      [STR_playtimes + STR_dotget,  'getPlaytimes'],
      [STR_playtimes + '.curr',     'currentPlaytime'],
      [STR_playtimes + '.next',     'nextPlaytime'],
  ]);

  addLegacyInterface('data', [
      [STR_db_get,    'getDBProperty'],
      [STR_db_get,    'getDBProperties'],
      [STR_props_get, 'getProperty'],
      [STR_props_get, 'getProperties'],
      ['props.query', 'queryProperties']
  ]);

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Load a new service.
  // Returns a premise(name) resolved once the service has been loaded.
  var services = {};
  function RequireService(name, config) {
   if (services[name] !== undefined) {
     if (config !== undefined) {
       slog.warn('Require ' + name + ': service already configured (new configuration ingnored).');
     }
     return services[name];
   }
   if (serviceReadyPromises[name]) {
    return serviceReadyPromises[name];
   }

   services[name] = SPECTRA.modules.require('spectra.' + name).then(function(Service) {
     var service = new Service(config);
     var init;
     if (service._initialize !== undefined) {
       init = service._initialize();
     }
     return when$(init).then(function() {
       SPECTRA[name] = service;
       // Last created, first destroyed.
       service_list.unshift(service);
       return service;
     }, function(e) {
       return { name: name, error: e };
     });
   }, function(e) {
     // Revert to service name.
     return { name: name, error: (e.error === undefined) ? e : e.error };
   });
   return services[name];
  }

  RO(SPECTRA, {
    when_initialized: LegacyWhenInitialized,
    require_service:  RequireService,
  });
})(this, SPECTRA);

/*
 * (c)2012-2013 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */
(function(context, SPECTRA) {
  var
    libutils = context.libutils,
    copy = libutils.copy,
    STR_SPECTRA_COMM = 'spectra.comm',
    slog = SPECTRA.log(STR_SPECTRA_COMM),
    location = context.location,
    transport_protocol = (location.protocol.toLowerCase() === 'http:') ? 'ws://' : 'wss://';

  function get_socket_provider(config) {
    if (config.type === 'online') {
      return new WebSocket(config.URL);
    }
    throw new Error("Not implemented '" + config.type + "'");
  }

  var Sockets_signal_provider = (function() {
    var default_config = {
      hostname  : location.hostname || '127.0.0.1',
      port      : 9000,
      folder    : 'broadcast',
      URL       : undefined,
      // broadcast parameters
      channel   : '',     // which channel to broadcast on
      id        : '',     // communications identifier
      lobby     : true,  // monitor who is entering / leaving
      snoop     : false, //  snoop messages - use sparingly
    };

    function finalize_config(config) {
      var
        final_config = copy(default_config);
      for (var k in config) {
        if (config[k] != null) {
          final_config[k] = config[k];
        }
      }
      final_config = copy(final_config);

      var
        non_params = [ 'hostname', 'port', 'folder', 'URL' ],
        base_url = transport_protocol + final_config.hostname + ':' + final_config.port + '/' + final_config.folder,
        params = Object.keys(final_config).filter(function(key) {
          return non_params.indexOf(key) === -1;
        }).reduce(function(tgt, key) {
          var prefix = (tgt === '')? '?': '&';
          prefix += key + '=';
          return tgt + prefix + encodeURIComponent(final_config[key]);
        }, '');

      final_config.URL = base_url + params;
      return final_config;
    }

    var Provider = function(config, handler) {
      var self = this;
      self._watcher = handler;
      self._config = finalize_config(config);
      self._connect_task = $.Deferred();
      self._connect();
    };

    Provider.prototype = {
      _connect: function() {
        var
          self = this,
          config = this._config;

        slog.log('Attempting to connect with config', config);
        var transport    = this.transport = get_socket_provider(config),
            watcher      = this._watcher,
            connect_task = this._connect_task;

        transport.onopen = function() {
          slog.log('connection to server established');
          connect_task.resolve(self);
        };

        transport.onclose = function(e) {
          if (connect_task.state() === 'pending') {
            slog.error('connection closed by host', e);
            connect_task.reject({ reason: 'connection closed by host', config: config });
          }
          slog.log('connection closed');
          watcher.onclose(e);
        };

        transport.onmessage = $.proxy(watcher._onmessage, watcher);

        transport.onerror = function(error) {
          slog.error('Transport error', error, config.URL);
          context.setTimeout(function() {
            // reconnect
            self._connect();
          }, 10000);
        };
      },

      promise: function() {
        return this._connect_task.promise();
      }
    }; // provider.prototype

    return Provider;
  })(); // sockets_signal_provider

  function make_signal_provider(config, handler) {
    return new Sockets_signal_provider(config, handler);
  }

  function do_send(provider, message) {
    slog.debug('sending ', message);
    provider.transport.send(JSON.stringify(message));
  }
  function LegacyClient(config) {
    var self = this;
    self._config = config;
    self._listeners = [];
    self._signal_provider = make_signal_provider(config, self);
  }
  LegacyClient.prototype = {
      // queue disabled for now.
    _enqueue_msg: function(type, message, recipient, timestamp) {
      do_send(this._signal_provider, {
        'type'    : type,
        'data'    : message,
        'to'      : recipient,
      });
    },

    send: function(message, recipient) {
      this._enqueue_msg('CHBC', message, recipient, Date.now());
    },

    finalize: function() {
      this._signal_provider.finalize();
      delete this._signal_provider;
    },

    listen: function(callback) {
      this._listeners.push(callback);
    },

    _onmessage: function(payload) {
      var comm_message;
      try {
        comm_message = JSON.parse(payload.data);
      } catch(e) {
        slog.error('Could not parse payload data', payload);
        return;
      }

      var
        type = comm_message.type,
        to = (comm_message.to === null) ? undefined : comm_message.to,
        my_id = this._config.id;

      if (type == null) { // check undef or null.
        slog.debug('Cannot handle message', type, to, my_id);
        return;
      }
      if (to !== undefined && my_id !== undefined && to !== my_id) {
        slog.debug('Message is not for me', comm_message, my_id);
        return;
      }

      slog.debug('Payload received ', comm_message);

      var hdr = ['from', 'to', 'channel'].reduce(function(tgt, key) {
        tgt[key] = tgt[key] == null? undefined: tgt[key];
        return tgt;
      }, {
        type:     type,
        to:       to,
        from:     (comm_message.from === undefined) ? undefined : comm_message.from,
        channel:  this._config.channel
      });

      var listener_message = {
        hdr:  hdr,
        data: comm_message.data || {}
      };

      this._listeners.forEach(function(fn) {
        fn(listener_message);
      });
    },

    onclose: function(reason) {
    },

    when_connected: function() {
      return $.when(this._signal_provider);
    }
  }; // LegacyClient.prototype

  function getClient(config) {
    SPECTRA.deprecation.once('moved', STR_SPECTRA_COMM + '.getClient', STR_SPECTRA_COMM + '.Client');
    var client = new LegacyClient(config);
    return client.when_connected().then(function() {
      return client;
    });
  }
  libutils.RO(SPECTRA.comm, {
    getClient: getClient
  });
})(this, SPECTRA);

/*
 * (c)2017 Stratacache. ALL RIGHT RESERVED
 * Copyright in the whole and every part of Spectra software belongs to Stratacache
 * ("the Owner") and may not be used, sold, licensed, transferred, copied or reproduced
 * in whole or in part in any manner or from or in or on any media to any person other
 * than in accordance with the terms of the Stratacache' General Conditions for Sales,
 * License and Technical Support Services or otherwise without the prior written consent
 * of the Owner.
 */

/**
 * Provides legacy interfaces to services
 * @file spectra.legacy.js
 *
**/
(function(SPECTRA) {
  var
    SPECTRAAssets = SPECTRA.assets,
    SPECTRAData = SPECTRA.data,
    STR_SPECTRA = 'SPECTRA',
    STR_SPECTRA_ASSETS = STR_SPECTRA + '.assets',
    SPECTRAUtils = SPECTRA.utils,
    deprecateOnce = SPECTRA.deprecation.once,
    RO = SPECTRAUtils.RO;

  // Notify of deprecated assets interface
  SPECTRAAssets.assetsmgr = function() {
    deprecateOnce('moved', STR_SPECTRA_ASSETS + '.assetsmgr', STR_SPECTRA_ASSETS);
    return SPECTRAAssets;
  };
  SPECTRAAssets.assetPath = function(src) {
    deprecateOnce('moved', STR_SPECTRA_ASSETS + '.assetPath', STR_SPECTRA_ASSETS + '.root');
    return SPECTRAAssets.root(src);
  };


  function LegacyCache(names, timeout, ext, updater) {
    var
      self = this,
      single = (typeof names === 'string'),
      lastValue;
      function get(name) {
        return (single || !name)? lastValue: lastValue[name];
      }
      function update() {
        return updater().then(function(data) {
          lastValue = data;
          return data;
        });
      }
      RO(RO(self, ext), {
        names: names,
        timeout: timeout,
        get: get,
        update: update,
        getUpdate: update
      });
  }

  function DeprecateAndForward(what, closure) {
    return function(a,b,c,d,e,f) {
      deprecateOnce('soon', what);
      return closure(a,b,c,d,e,f);
    };
  }

  function makePropCache(names, timeout) {
    return new LegacyCache(names, timeout, {}, function() {
      return SPECTRAData.getProperty(names, timeout);
    });
  }
  function makePropsCache(names, timeout) {
    return new LegacyCache(names, timeout, {}, function() {
      return SPECTRAData.getProperties(names, timeout);
    });
  }

  function makeDBProp(db, table, colname, colval, names, timeout) {
    return new LegacyCache(names, timeout,
      {db:db, table:table, colname:colname, colval:colval},
      function() {
        if (Array.isArray(names)) {
          names = names[0];
        }
        return SPECTRAData.getDBProperty(db, table, colname, colval, names, timeout);
      }
    );
  }
  function makeDBProps(db, table, colname, colval, names, timeout) {
    return new LegacyCache(names, timeout,
      {db:db, table:table, colname:colname, colval:colval},
      function() {
        names = names || [];
        return SPECTRAData.getDBProperties(db, table, colname, colval, names, timeout).then(function(result) {
          for (var k in result) {
            var value = result[k];
            if (Array.isArray(value) && value.length === 0) {
              result[k] = '';
            }
          }
          return result;
        });
      }
    );
  }


  // Add old PropsCache/DBPropsCache interfaces
  var legacyMap = {
    property:     makePropCache,
    properties:   makePropsCache,
    dbproperty:   makeDBProp,
    dbproperties: makeDBProps
  };
  for (var k in legacyMap) {
    legacyMap[k] = DeprecateAndForward('SPECTRA.data.' + k, legacyMap[k]);
  }
  RO(SPECTRAData, legacyMap);

  RO(SPECTRA, {
    list_services:    function() {
      deprecateOnce('gone', 'SPECTRA.list_services');
    },
    eachprop:       SPECTRAUtils.eachprop, // legacy
    safeJSONParse:  SPECTRAUtils.safeJSONParse,
    // Return true when in given mode (preview or player), false otherwise.
    is_mode: function(mode) {
      return SPECTRA.impl.mode === mode;
    },
    impl_id: function() {
      return SPECTRA.impl.id;
    }
  });

  SPECTRA.modules.define('spectra.log', function(dependents) {
      deprecateOnce('soon', 'module spectra.log');
    return SPECTRA.log;
  });

  // Internally, SAPI should use SPECTRA.utils.RO

//  RO(window, {
//    defineROProperties: RO
//  });

})(SPECTRA);
