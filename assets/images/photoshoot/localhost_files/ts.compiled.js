'use strict';

var CODModule = /** @class */function () {
    function CODModule() {}
    CODModule.prototype.start = function (meta, results) {
        return new Promise(function (resolve, reject) {
            libDMB.data.get('tags', ["cod_suggestive_sell"]).then(function (result) {
                result.cod_suggestive_sell ? resolve(result.cod_suggestive_sell) : reject({
                    msg: 'CODModule: Failed to get the COD Suggestive Sell tag.',
                    level: 'error',
                    values: [{ meta: meta }, { cod_suggestive_sell: result }]
                });
            });
        });
    };
    return CODModule;
}();
var LineupsModule = /** @class */function () {
    function LineupsModule() {}
    LineupsModule.prototype.start = function (meta, results) {
        return new Promise(function (resolve, reject) {
            var dmbregion = 'breakfast' === meta.dayPart ? 'breakfast-value-master' : 'restofday-value-master';
            var context = {
                "__dmb__": {
                    "region": dmbregion
                }
            };
            var lineup_result = libDMB.data.get('tags', ["breakfastvalue_lineup", "restofdayvalue_lineup"], context);
            var result = {
                "valueMaster": {
                    "breakfast": lineup_result["breakfastvalue_lineup"],
                    "restofday": lineup_result["restofdayvalue_lineup"]
                }
            };
            lineup_result ? resolve(result) : reject({
                msg: 'LibDMB could not find store profile information.',
                level: 'error',
                values: [{ meta: meta }, { lineup_result: lineup_result }, { result: result }]
            });
        });
    };
    return LineupsModule;
}();
var McPickModule = /** @class */function () {
    function McPickModule() {}
    McPickModule.prototype.start = function (meta) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var mcpick = _this.queryPromoEngine(meta.tags.posPromos).then(function (dbResults) {
                return _this.mcpickPromoEngineThings(dbResults, meta.dayPart, meta.states, meta);
            })["catch"](function (err) {
                $_.info('Falling back from mcpickPromoEngine to static prices.');
                return DMBCore.Prices.get(getURLParam('daypart') === 'breakfast' ? ['98007'] : ['2692', '98006']);
            })["catch"](function (err) {
                $_.error('Unable to retreive any mcpick price', err);
                return false;
            });
            Promise.all([mcpick]).then(function (values) {
                values[0] ? resolve(values[0]) : reject({
                    msg: 'The McPick Module failed.',
                    level: 'error',
                    values: []
                });
            });
        });
    };
    McPickModule.prototype.queryPromoEngine = function (posPromoEngine) {
        return new Promise(function (resolve, reject) {
            posPromoEngine === 'true' ? resolve(DMBCore.table('Promos').all(['promo'])) : reject('Unable to get data from Promos table on Macdo.db. Attempting to get static prices.');
        });
    };
    McPickModule.prototype.mcpickPromoEngineThings = function (dbResults, dayPart, states, params) {
        console.log("mcpickPromoEngineThings");
        return new Promise(function (resolve, reject) {
            // db spoof data to test updates to promo engine
            // var spoofArr = [["2292|4314|6050|592|5", "2", "2016-03-08", "2018-12-31"],["5|7|5280|5926", "5.8", "2017-03-08", "2018-12-31"],["83|4148|24|46|6136|61", "2.5", "2017-03-08", "2018-12-31"]];
            // var mcpickPrices = mcpickPromoEngine(tagData[tagNames.promoEngineLineup], spoofArr, states, params);
            // check if dbResults.promo.constructor is an array, if not convert it an array (MCAP-2458)
            if (typeof dbResults.promo[0] === 'string') {
                dbResults.promo = [dbResults.promo];
            }
            var lineup = dayPart === 'breakfast' ? 'tags.breakfastvalue_lineup' : 'tags.restofdayvalue_lineup';
            var mcpickPrices = this.mcpickPromoEngine(lineup, dbResults.promo, states, params);
            mcpickPrices ? resolve(mcpickPrices) : reject(new Error('Promo engine could not obtain a price'));
        });
    };
    /**
     * mcPickPromoEngine executes the main sequence of events required to return a mcpickx final price,
     * mcpicky final price, or a final price for both.
     *
     * @param {String} the Value of tags.breakfastvalue_lineup (or tags.restofdayvalue_lineup).
     * @param {Array} the results of the data provider query.
     * @param {Object} the results of libDMB get state.
     * @rturn {Object}
     */
    McPickModule.prototype.mcpickPromoEngine = function (lineup, promoArr, states, params) {
        console.log("mcPickPromoEngine");
        // Determine if a final price is needed for x, y or both.
        var xyb = this.xyOrBoth(lineup);
        // Obtain the mcpick products from the get state.
        var mcpickObj = this.generateMcpickObj(xyb, states, params);
        // Return the simple object containing an x final price, y final price, or a final price for both.
        return this.grabFinalPrice(mcpickObj, promoArr);
    };
    /**
     * xyOrBoth looks at the value of the lineup tag for mcpickx and mcpicky.
     *
     * @param {String} the Value of the lineup tag.
     * @return {Array}
     */
    McPickModule.prototype.xyOrBoth = function (lineup) {
        console.log("xyOrBoth");
        var stagingArr = [];
        var lookForThese = ['mcpickx', 'mcpicky'];
        for (var i = 0; i < lookForThese.length; i++) {
            // If the current index of lookForThese is found in the lineup, push it to the staging array.
            if (lineup.indexOf(lookForThese[i]) != -1) {
                // Before pushing to the array put a hyphen between mcpick and the x(y) since it is
                // denoted as such in the get state object.
                stagingArr.push(lookForThese[i].slice(0, -1) + '-' + lookForThese[i].slice(-1));
            }
        }
        return stagingArr;
    };
    /**
     * generateMcpickObj looks for mcpick region objects in the get state and returns them for use.
     *
     * @param {Array} an array of the mcpick regions we need to find.
     * @param {Object} the resulst of the get state.
     * @return {Object}
     */
    McPickModule.prototype.generateMcpickObj = function (xyb, states, params) {
        console.log("generateMcpickObj()");
        var stagingObj = {};
        for (var i = 0; i < xyb.length; i++) {
            stagingObj[xyb[i].slice(-1)] = states[params.location + '-' + params.orientation + '-' + params.dayPart + '-' + xyb[i]].result.state;
        }
        return stagingObj;
    };
    McPickModule.prototype.grabFinalPrice = function (mcpickObj, promoArr) {
        console.log("grabFinalPrice");
        // Create empty object, this will contain the final prices which will be returned for use in data adapter.
        var finalPrices = {};
        // Generate todays date for comparison with the start and end dates in the promo.
        var todaysDate = new Date(Date.now());
        // Loop through all the mcpick regions found in generateMcpickObj().
        for (var mcpickObjKey in mcpickObj) {
            // The product codes needed to compare with the promo codes will be the keys from the products property
            // in the mcpick region object we are currently looping through.
            var slots = mcpickObj[mcpickObjKey].slots;
            slots = Object.keys(slots).filter(function (key) {
                return undefined !== slots[key].pid && "" !== slots[key].pid && "none" !== slots[key].pid;
            }).map(function (key) {
                return slots[key].pid;
            });
            var stateCodes = mcpickObj[mcpickObjKey].products;
            var datePass = false;
            var pricePass;
            // Begin loopin through the promos array. The promos array is an array of arrays each containing promo data.
            for (var promoArrI = 0; promoArrI < promoArr.length; promoArrI++) {
                // Assign promo for easy access and readability.
                var promo = promoArr[promoArrI];
                // The following four values will always be at the same indeces.
                var promoCodes = promo[0].split("|").map(function (code) {
                    return Number(code);
                });
                var finalPrice = promo[1];
                var startDate = new Date(promo[2].replace(new RegExp('-', 'g'), '/'));
                var endDate = new Date(promo[3].replace(new RegExp('-', 'g'), '/'));
                // Establish a codePass variable to track whether or not the prodcuts in mcpick pass or fail
                // The promo requirements.
                var codePass = false;
                for (var i = 0; i < slots.length; i++) {
                    // We only want to consider the numeric product codes in the get state.
                    if (Number(stateCodes[slots[i]].dynID)) {
                        // If the product code from get state is not found in the promo code, fail and berak the loop.
                        if (_.indexOf(promoCodes, stateCodes[slots[i]].dynID) === -1) {
                            codePass = false;
                            break;
                        } else {
                            codePass = true;
                        }
                    }
                }
                if (codePass) {
                    if (datePass && startDate <= todaysDate && todaysDate <= endDate) {
                        datePass = false;
                        pricePass = undefined;
                        break;
                    } else if (startDate <= todaysDate && todaysDate <= endDate) {
                        datePass = true;
                        pricePass = finalPrice;
                    }
                }
            }
            if (datePass && undefined != pricePass) {
                finalPrices[mcpickObjKey] = pricePass;
            }
        }
        return finalPrices;
    };
    return McPickModule;
}();
var Startup = /** @class */function () {
    function Startup() {
        // Instantiate our App Dependences of DMBCore, StrataDash, and TackleBox
        window['$_'] = new StrataDash.Base(6);
        window['Hooks'] = new TackleBox.Hooks();
        window['DMBCore'] = new DMBCORE.DMBCore();
        this.start();
    }
    Startup.prototype.start = function () {
        var _this = this;
        DMBCore.configure().then(function () {
            // Start the App!
            return DMBCore.startApp();
        }).then(function () {
            return DMBCore.AppInit.run({
                promos: DMBCore.AppInit.Module.Promos,
                assetData: DMBCore.AppInit.Module.Assets
            }, _this.postStart.bind(_this));
        }).then(function () {
            // Now that all of the JS setup is resolved, remove the unresolved attribute to show the content.
            document.querySelector('body').removeAttribute('unresolved');
            $_.info('Main has been refreshed.');
            return libDMB.editor.editorReady();
        })["catch"](function (err) {
            console.error("ERROR", err);
        });
    };
    Startup.prototype.postStart = function (init_result) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            // Create the required App Config for Data Adapter
            _this.appConfig = _.chain(DMBCore.Params.allSync()).merge(init_result).merge({ editMode: DMBCore.Env.EditMode.isActive() }).omit('promos').omit('profile').omit('assets').value();
            //console.log('init_result.assetData',init_result.assetData);
            DMBCore.State.Store.dispatch(DMBCore.State.Actions.setNewAssetData(init_result.assetData));
            // setTimeout(() => {
            DMBCore.drawMaster(DMBCore.Profile.allSync(), _this.appConfig);
            _this.promos = init_result.promos;
            _this.DataAdapter = new DataAdapter.Main();
            _this.DataAdapter.makeAppData(_this.appConfig, DMBCore.State.getSync(), _this.promos, { prefix: DMBCore.getPrefix() }).then(function (adapted_data) {
                DMBCore.State.Store.dispatch(DMBCore.State.Actions.setNewAppData(adapted_data));
                _this.adaptedData = adapted_data;
                $_.startNamespace('app-info');
                $_.groupInfo('/*----------APP INFO------------*/');
                $_.info("Congratulations! You are running libDMB version " + _.get(libDMB, 'version.tag', '<failed to get version>') + "!");
                $_.info("You are in the " + DMBCore.Env.environment() + " environment.");
                $_.info('URL PARAMS', DMBCore.Params.allSync());
                $_.info('INIT RESULT', init_result);
                $_.info("STATE", DMBCore.State.getSync());
                $_.info("ALL PRODUCTS", DMBCore.Products.allSync());
                $_.info("STORE PROFILE", DMBCore.Profile.allSync());
                $_.info("PROMO DATA FROM LIBDMB", _this.promos);
                $_.info("ASSET DATA", init_result.assetData);
                $_.info("APP CONFIG", _this.appConfig);
                $_.info('DA RESULT', adapted_data);
                $_.groupEnd();
                $_.endNamespace();
                // Return the adapted data
                resolve();
            });
            // }, 10000);
        });
    };
    return Startup;
}();
var FunctionalHelpers = function () {
    return {
        condenseObjects: function condenseObjects(arr_of_objs) {
            var obj = arr_of_objs.reduce(function (acc, val) {
                var properties = Object.keys(val);
                properties.forEach(function (cur) {
                    acc[cur] = val[cur];
                });
                return acc;
            }, {});
            return obj ? obj : null;
        },
        // Consider using javascript Array.prototype.concat instead of this function.
        pushToArray: function pushToArray(original_item_s, new_item_s) {
            var original_arr = original_item_s.constructor === Array ? original_item_s : [original_item_s];
            var new_item_arr = new_item_s.constructor === Array ? new_item_s : [new_item_s];
            var new_arr = original_arr.reduce(function (acc, val, i) {
                acc.push(val);
                if (original_arr.length - 1 === i) {
                    new_item_arr.forEach(function (item) {
                        acc.push(item);
                    });
                }
                return acc;
            }, []);
            return new_arr ? new_arr : null;
        }
    };
}();
var ODValueMeals = /** @class */function () {
    function ODValueMeals(slots, dimensions) {
        this.slots = slots.slice();
        this.dimensions = dimensions.slice();
        this.initPanels();
        this.findRemainder();
        this.addFeaturettes();
        this.addTradeups();
    }
    ODValueMeals.prototype.initPanels = function () {
        var _this = this;
        this.panels = [];
        this.remainders = [];
        this.largestY = 0;
        this.dimensions.forEach(function (bounds, i) {
            _this.panels.push([]);
            for (var x = 0; x < bounds.x; x += 1) {
                _this.panels[i].push([]);
            }
            _this.remainders.push(0);
            if (_this.largestY < bounds.y) _this.largestY = bounds.y;
        });
    };
    ODValueMeals.prototype.findRemainder = function () {
        var _this = this;
        var slots = this.slots.slice();
        var _loop_1 = function _loop_1() {
            var continue_row = 0 < slots.length;
            this_1.panels.forEach(function (panel, i) {
                for (var x = 0; x < panel.length; x += 1) {
                    if (continue_row) {
                        if (0 < slots.length && y < _this.dimensions[i].y) {
                            panel[x].push(slots.shift());
                        } else if (_this.dimensions[i].y > y) {
                            _this.remainders[i] += 1;
                        }
                    }
                }
            });
        };
        var this_1 = this;
        for (var y = 0; y < this.largestY; y += 1) {
            _loop_1();
        }
    };
    ODValueMeals.prototype.addFeaturettes = function () {
        var _this = this;
        // assets => slot.product.assets returns array
        // featurettes appear to be missing type featurette so will have to look at .assetPath
        this.panels.forEach(function (panel, i) {
            panel.forEach(function (col, x) {
                col.forEach(function (slot) {
                    if (_this.checkRemainders()) {
                        var assets = _.get(slot, 'product.assets', null);
                        var presence = _this.hasFeaturette(assets);
                        var upper_x = _this.dimensions[i].x;
                        if (presence && upper_x - 1 > x) {
                            var num = slot.mealNumber;
                            var slot_index = _this.findSlotInSlots(num);
                            var featurette_flag = { featurette: true, mealNumber: num };
                            _this.putFeaturetteInMeta(slot_index);
                            _this.slots.splice(slot_index, 0, featurette_flag);
                            _this.initPanels();
                            _this.findRemainder();
                        }
                    }
                });
            });
        });
    };
    ODValueMeals.prototype.checkRemainders = function () {
        for (var i = 0; i < this.remainders.length; i += 1) {
            if (0 < this.remainders[i]) return true;
        }
        return false;
    };
    ODValueMeals.prototype.putFeaturetteInMeta = function (index) {
        var slot = this.slots[index];
        var meta = slot.product.meta || {};
        meta['featurette'] = true;
        slot.product.meta = meta;
    };
    ODValueMeals.prototype.hasFeaturette = function (assets) {
        if (assets) {
            var presence = _.findIndex(assets, function (a) {
                return 'featurette' === a.type;
            });
            return -1 != presence;
        }
        return false;
    };
    ;
    ODValueMeals.prototype.findSlotInSlots = function (num) {
        var i = _.findIndex(this.slots, function (slot) {
            return num === slot.mealNumber;
        });
        return i;
    };
    ODValueMeals.prototype.addTradeups = function () {
        var _this = this;
        var flat_panels = this.panels.map(function (panel, i) {
            var flat = _.flatten(panel).sort(function (slotA, slotB) {
                return slotA.mealNumber - slotB.mealNumber;
            });
            var val = _this.remainders[i] || false;
            if (val) flat.push({ tradeup: true, width: val });
            return flat;
        });
        this.result = flat_panels;
    };
    ODValueMeals.prototype.getResult = function () {
        return this.result;
    };
    return ODValueMeals;
}();
var SlotAllocator = /** @class */function () {
    /*----------------------------------------------------------------------------
    | - INITIALIZATION -
    ----------------------------------------------------------------------------*/
    function SlotAllocator(items_to_load, weight, spacers, back_load) {
        this.strict_rules = null;
        this.result = [];
        this.items_to_load = items_to_load instanceof Array ? items_to_load : [];
        this.weight = weight;
        this.spacers = true === spacers ? true : false;
        this.back_load = true === back_load ? true : false;
    }
    /*----------------------------------------------------------------------------
    | - PUBLIC METHODS -
    ----------------------------------------------------------------------------*/
    SlotAllocator.prototype.loadItems = function (num_of_loadable_units) {
        if (this.weight instanceof Array && 0 < this.weight.length) {
            this.num_of_loadable_units = this.weight.length;
            if ($_.arrayContents(this.weight, 'number')) {
                this.loadSpecific();
            } else if ($_.arrayContents(this.weight, 'string')) {
                this.loadStrict();
            }
        } else if (_.isFinite(this.weight)) {
            this.num_of_loadable_units = undefined != num_of_loadable_units && _.isFinite(num_of_loadable_units) ? num_of_loadable_units : Math.ceil(this.items_to_load.length / this.weight);
            this._load();
        }
    };
    SlotAllocator.prototype.spliceItems = function (num_of_loadable_units) {
        if (this.weight instanceof Array && this.weight.length) {
            this.num_of_loadable_units = this.weight.length;
            if ($_.arrayContents(this.weight, 'number')) {
                this.spliceSpecific();
            }
        } else if (_.isFinite(this.weight)) {
            this.num_of_loadable_units = undefined != num_of_loadable_units && _.isFinite(num_of_loadable_units) ? num_of_loadable_units : Math.ceil(this.items_to_load.length / this.weight);
            this._splice();
        }
    };
    /*----------------------------------------------------------------------------
    | - "COMPOSER" METHODS -
    ----------------------------------------------------------------------------*/
    SlotAllocator.prototype._load = function () {
        this.convertNumWeightToArrayWeight();
        this.scaffold();
        this.assignItemsToUnits();
        this.checkBackLoad();
        this.result = this.loadItemsIntoUnits();
    };
    SlotAllocator.prototype.loadSpecific = function () {
        this.scaffold();
        this.assignItemsToUnits();
        this.checkBackLoad();
        this.result = this.loadItemsIntoUnits();
    };
    SlotAllocator.prototype.loadStrict = function () {
        if (this.separateWeightFromRules()) {
            this.scaffold();
            this.assignItemsToUnits();
            this.checkBackLoad();
            this.result = this.loadItemsIntoUnits();
        } else {
            this.result = [];
        }
        ;
    };
    SlotAllocator.prototype._splice = function () {
        this.convertNumWeightToArrayWeight();
        this.result = this.spliceItemsIntoUnits();
    };
    SlotAllocator.prototype.spliceSpecific = function () {
        this.result = this.spliceItemsIntoUnits();
    };
    /*----------------------------------------------------------------------------
    | - BUILDING BLOCK METHODS -
    ----------------------------------------------------------------------------*/
    SlotAllocator.prototype.convertNumWeightToArrayWeight = function () {
        var staging_arr = [];
        for (var i = 0; i < this.num_of_loadable_units; i++) {
            staging_arr.push(this.weight);
        }
        this.weight = staging_arr;
    };
    SlotAllocator.prototype.separateWeightFromRules = function () {
        this.strict_rules = [];
        for (var i = 0; i < this.num_of_loadable_units; i++) {
            var weight_rules = this.weight[i].split(',');
            if (2 === weight_rules.length) {
                var split_weight = Number(weight_rules[0]);
                var split_rules = [];
                weight_rules[1].split('-').forEach(function (rule, i) {
                    split_rules.push(Number(rule));
                });
                if (2 === split_rules.length) {
                    this.weight[i] = _.isFinite(split_weight) ? split_weight : 0;
                    $_.arrayContents(split_rules, 'number') ? this.strict_rules.push(split_rules) : this.strict_rules.push([0, 0]);
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }
        return true;
    };
    SlotAllocator.prototype.scaffold = function () {
        this.scaffolding_arr = [];
        for (var i = 0; i < this.num_of_loadable_units; i++) {
            var staging_arr = [];
            for (var j = 0; j < this.weight[i]; j++) {
                staging_arr.push(0);
            }
            this.scaffolding_arr.push(staging_arr);
        }
    };
    SlotAllocator.prototype.assignItemsToUnits = function () {
        var total_items = this.items_to_load.length;
        for (var j = 0; j < _.max(this.weight); j++) {
            for (var i = 0; i < this.num_of_loadable_units; i++) {
                if (j < this.weight[i] && 0 < total_items) {
                    this.scaffolding_arr[i][j]++;
                    total_items--;
                }
            }
        }
    };
    SlotAllocator.prototype.checkBackLoad = function () {
        if (true === this.back_load) {
            _.reverse(this.scaffolding_arr);
        }
    };
    SlotAllocator.prototype.loadItemsIntoUnits = function () {
        var result = [];
        for (var j = 0; j < this.scaffolding_arr.length; j++) {
            var staging_arr = [];
            for (var k = 0; k < this.scaffolding_arr[j].length; k++) {
                var value = this.scaffolding_arr[j][k];
                if (1 === value && this.evaluateRule(j)) {
                    staging_arr.push(this.items_to_load.shift());
                } else if (0 === value && this.strict_rules instanceof Array && this.evaluateRule(j)) {
                    staging_arr.push(this.items_to_load.shift());
                } else if (true === this.spacers) {
                    staging_arr.push({ "spacer": 1, "product": { "productCode": "spacer" } });
                }
            }
            result.push(staging_arr);
        }
        return result;
    };
    SlotAllocator.prototype.evaluateRule = function (index) {
        if (this.strict_rules instanceof Array) {
            var rule = this.strict_rules[index];
            for (var i = 0; i < this.items_to_load.length; i++) {
                var id = this.items_to_load[0].mealNumber;
                if (rule[0] <= id && id <= rule[1]) {
                    return true;
                } else {
                    this.items_to_load.push(this.items_to_load.shift());
                }
            }
            return false;
        } else {
            return true;
        }
    };
    SlotAllocator.prototype.spliceItemsIntoUnits = function () {
        var weight = this.weight;
        var staging_arr = [];
        for (var i = 0; i < weight.length; i++) {
            if (this.items_to_load.length) {
                staging_arr.push(this.items_to_load.splice(0, weight[i]));
            }
        }
        return staging_arr;
    };
    /*----------------------------------------------------------------------------
    | - GETTER -
    ----------------------------------------------------------------------------*/
    SlotAllocator.prototype.getResult = function () {
        if (undefined != this.result && null != this.result) {
            return this.result;
        } else {
            return [];
        }
    };
    return SlotAllocator;
}();