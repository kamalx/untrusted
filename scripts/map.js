function Map(display, __game) {
    /* private variables */

    var __player;
    var __grid;
    var __dynamicObjects = [];
    var __objectDefinitions;

    var __lines;
    var __dom;
    var __domCSS = '';

    var __allowOverwrite;
    var __keyDelay;
    var __refreshRate;

    var __intervals = [];
    var __chapterHideTimeout;

    /* unexposed variables */

    this._properties = {};
    this._display = display;
    this._dummy = false; // overridden by dummyMap in validate.js
    this._status = '';

    /* unexposed getters */

    this._getObjectDefinition = function(objName) { return __objectDefinitions[objName]; };
    this._getObjectDefinitions = function() { return __objectDefinitions; };
    this._getGrid = function () { return __grid; };

    /* exposed getters */

    this.getDynamicObjects = function () { return __dynamicObjects; };
    this.getPlayer = function () { return __player; };
    this.getWidth = function () { return __game._dimensions.width; };
    this.getHeight = function () { return __game._dimensions.height; };

    /* unexposed methods */

    this._reset = function () {
        __objectDefinitions = clone(__game.objects);

        this._display.clear();

        __grid = new Array(__game._dimensions.width);
        for (var x = 0; x < __game._dimensions.width; x++) {
            __grid[x] = new Array(__game._dimensions.height);
            for (var y = 0; y < __game._dimensions.height; y++) {
                __grid[x][y] = {type: 'empty'};
            }
        }

        this.getDynamicObjects().forEach(function (obj) {
            obj._destroy(true);
        });
        __dynamicObjects = [];
        __player = null;

        for (var i = 0; i < __intervals.length; i++) {
            clearInterval(__intervals[i]);
        }
        __intervals = [];

        __lines = [];
        __dom = '';
        this._overrideKeys = {};

        // preload stylesheet for DOM level
        $.get('styles/dom.css', function (css) {
            __domCSS = css;
        });

        this.finalLevel = false;
    };

    this._ready = function () {
        var map = this;

        // set refresh rate if one is specified
        if (__refreshRate) {
            map.startTimer(function () {
                // refresh the map
                map.refresh();

                // rewrite status
                if (map._status) {
                    map.writeStatus(map._status);
                }

                // check for nonstandard victory condition
                if (typeof(__game.objective) === 'function' && __game.objective(map)) {
                    __game._moveToNextLevel();
                }
            }, __refreshRate);
        }
    };

    this._setProperties = function (mapProperties) {
        // set defaults
        this._properties = {};
        __allowOverwrite = false;
        __keyDelay = 0;
        __refreshRate = null;

        // now set any properties that were passed in
        if (mapProperties) {
            this._properties = mapProperties;

            if (mapProperties.allowOverwrite === true) {
                __allowOverwrite = true;
            }

            if (mapProperties.keyDelay) {
                __keyDelay = mapProperties.keyDelay;
            }

            if (mapProperties.refreshRate) {
                __refreshRate = mapProperties.refreshRate;
            }
        }
    };

    this._canMoveTo = function (x, y, myType) {
        if (x < 0 || x >= __game._dimensions.width || y < 0 || y >= __game._dimensions.height) {
            return false;
        }

        // look for static objects that can serve as obstacles
        var objType = __grid[x][y].type;
        var object = __objectDefinitions[objType];
        if (object.impassable) {
            if (myType && object.passableFor && object.passableFor.indexOf(myType) > -1) {
                // this object is of a type that can pass the obstacle
                return true;
            } else if (typeof object.impassable === 'function') {
                // the obstacle is impassable only in certain circumstances
                try {
                    return !object.impassable(__player, object);
                } catch (e) {
                    display.writeStatus(e.toString());
                }
            } else {
                // the obstacle is always impassable
                return false;
            }
        } else if (myType && object.impassableFor && object.impassableFor.indexOf(myType) > -1) {
            // this object is of a type that cannot pass the obstacle
            return false;
        } else {
            // no obstacle
            return true;
        }
    };

    // Returns the object of the given type closest to target coordinates
    this._findNearestToPoint = function (type, targetX, targetY) {
        var foundObjects = [];

        // look for static objects
        for (var x = 0; x < this.getWidth(); x++) {
            for (var y = 0; y < this.getHeight(); y++) {
                if (__grid[x][y].type === type) {
                    foundObjects.push({x: x, y: y});
                }
            }
        }

        // look for dynamic objects
        for (var i = 0; i < this.getDynamicObjects().length; i++) {
            var object = this.getDynamicObjects()[i];
            if (object.getType() === type) {
                foundObjects.push({x: object.getX(), y: object.getY()});
            }
        }

        // look for player
        if (type === 'player') {
            foundObjects.push({x: __player.getX(), y: __player.getY()});
        }

        var dists = [];
        for (var i = 0; i < foundObjects.length; i++) {
            var obj = foundObjects[i];
            dists[i] = Math.sqrt(Math.pow(targetX - obj.x, 2) + Math.pow(targetY - obj.y, 2));

            // We want to find objects distinct from ourselves
            if (dists[i] === 0) {
                dists[i] = 999;
            }
        }

        var minDist = Math.min.apply(Math, dists);
        var closestTarget = foundObjects[dists.indexOf(minDist)];

        return closestTarget;
    };

    this._isPointOccupiedByDynamicObject = function (x, y) {
        for (var i = 0; i < this.getDynamicObjects().length; i++) {
            var object = this.getDynamicObjects()[i];
            if (object.getX() === x && object.getY() === y) {
                return true;
            }
        }
        return false;
    };

    this._findDynamicObjectAtPoint = function (x, y) {
        for (var i = 0; i < this.getDynamicObjects().length; i++) {
            var object = this.getDynamicObjects()[i];
            if (object.getX() === x && object.getY() === y) {
                return object;
            }
        }
        return false;
    };

    this._moveAllDynamicObjects = function () {
        // the way things work right now, teleporters must take precedence
        // over all other objects -- otherwise, pointers.jsx will not work
        // correctly.
        // TODO: make this not be the case

        // "move" teleporters
        this.getDynamicObjects().filter(function (object) {
            return (object.getType() === 'teleporter');
        }).forEach(function(object) {
            object._onTurn();
        });

        // move everything else
        this.getDynamicObjects().filter(function (object) {
            return (object.getType() !== 'teleporter');
        }).forEach(function(object) {
            object._onTurn();
        });

        // refresh only at the end
        this.refresh();
    };

    this._removeItemFromMap = function (x, y, klass) {
        if (__grid[x][y].type === klass) {
            __grid[x][y].type = 'empty';
        }
    };

    this._reenableMovementForPlayer = function (player) {
        setTimeout(function () {
            player._canMove = true;
        }, __keyDelay);
    };

    this._hideChapter = function() {
        // start fading out chapter immediately
        // unless it's a death message, in which case wait 2.5 sec
        clearInterval(__chapterHideTimeout);
        __chapterHideTimeout = setTimeout(function () {
            $('#chapter').fadeOut(1000);
        }, $('#chapter').hasClass('death') ? 2500 : 0);

        // also, clear any status text if map is refreshing automatically (e.g. boss level)
        this._status = '';
    };

    this._refreshDynamicObjects = function() {
        __dynamicObjects = __dynamicObjects.filter(function (obj) { return !obj._isDestroyed(); });
    };

    this._countTimers = function() {
        return __intervals.length;
    }

    /* (unexposed) wrappers for game methods */

    this._endOfStartLevelReached = function() {
        __game._endOfStartLevelReached = true;
    };

    this._playSound = function (sound) {
        __game.sound.playSound(sound);
    };

    this._validateCallback = function (callback) {
        return __game.validateCallback(callback);
    };

    /* exposed methods */

    this.refresh = function () {
        if (__dom) {
            this._display.clear();

            var domHTML = __dom[0].outerHTML
                .replace(/"/g, "'")
                .replace(/<hr([^>]*)>/g, '<hr $1 />')
                .replace(/<img([^>]*)>/g, '<img $1 />');

            this._display.renderDom(domHTML, __domCSS);
        } else {
            this._display.drawAll(this);
        }
        __game.drawInventory();
    };

    this.countObjects = function (type) {
        var count = 0;

        // count static objects
        for (var x = 0; x < this.getWidth(); x++) {
            for (var y = 0; y < this.getHeight(); y++) {
                if (__grid[x][y].type === type) {
                    count++;
                }
            }
        }

        // count dynamic objects
        this.getDynamicObjects().forEach(function (obj) {
            if (obj.getType() === type) {
                count++;
            }
        })

        return count;
    };

    this.placeObject = function (x, y, type) {
        if (!__objectDefinitions[type]) {
            throw "There is no type of object named " + type + "!";
        }

        if (typeof(__grid[x]) === 'undefined' || typeof(__grid[x][y]) === 'undefined') {
            return;
            // throw "Not a valid location to place an object!";
        }

        if (__objectDefinitions[type].type === 'dynamic') {
            // dynamic object
            __dynamicObjects.push(new DynamicObject(this, type, x, y));
        } else {
            // static object
            if (__grid[x][y].type === 'empty' || __grid[x][y].type === type || __allowOverwrite) {
                __grid[x][y].type = type;
            } else {
                throw "There is already an object at (" + x + ", " + y + ")!";
            }
        }
    };

    this.placePlayer = function (x, y) {
        if (__player) {
            throw "Can't place player twice!";
        }
        __player = new __game._playerPrototype(x, y, this, __game);
        this._display.drawAll(this);
    };

    this.createFromGrid = function (grid, tiles, xOffset, yOffset) {
        for (var y = 0; y < grid.length; y++) {
            var line = grid[y];
            for (var x = 0; x < line.length; x++) {
                var tile = line[x];
                var type = tiles[tile];
                if (type === 'player') {
                    this.placePlayer(x + xOffset, y + yOffset);
                } else if (type) {
                    this.placeObject(x + xOffset, y + yOffset, type);
                }
            }
        }
    };

    this.setSquareColor = function (x, y, bgColor) {
        __grid[x][y].bgColor = bgColor;
    };

    this.defineObject = function (name, properties) {
        if (__objectDefinitions[name]) {
            throw "There is already a type of object named " + name + "!";
        }

        if (properties.interval && properties.interval < 100) {
            throw "defineObject(): minimum interval is 100 milliseconds";
        }

        __objectDefinitions[name] = properties;

    };

    this.getObjectTypeAt = function (x, y) {
        return __grid[x][y].type;
    }

    this.getAdjacentEmptyCells = function (x, y) {
        var map = this;
        var actions = ['right', 'down', 'left', 'up'];
        var adjacentEmptyCells = [];
        $.each(actions, function (i, action) {
            switch (actions[i]) {
                case 'right':
                    var child = [x+1, y];
                    break;
                case 'left':
                    var child = [x-1, y];
                    break;
                case 'down':
                    var child = [x, y+1];
                    break;
                case 'up':
                    var child = [x, y-1];
                    break;
            }
            if (map.getObjectTypeAt(child[0], child[1]) === 'empty') {
                adjacentEmptyCells.push([child, action]);
            }
        });
        return adjacentEmptyCells;
    };

    this.startTimer = function(timer, delay) {
        if (!delay) {
            throw "startTimer(): delay not specified"
        } else if (delay < 25) {
            throw "startTimer(): minimum delay is 25 milliseconds";
        }

        __intervals.push(setInterval(timer, delay));
    };

    this.displayChapter = function(chapterName, cssClass) {
        if (__game._displayedChapters.indexOf(chapterName) === -1) {
            $('#chapter').html(chapterName.replace("\n","<br>"));
            $('#chapter').removeClass().show();

            if (cssClass) {
                $('#chapter').addClass(cssClass);
            } else {
                __game._displayedChapters.push(chapterName);
            }

            setTimeout(function () {
                $('#chapter').fadeOut();
            }, 5 * 1000);
        }
    };

    this.writeStatus = function(status) {
        this._status = status;

        if (__refreshRate) {
            // write the status immediately
            display.writeStatus(status);
        } else {
            // wait 100 ms for redraw reasons
            setTimeout(function () {
                display.writeStatus(status);
            }, 100);
        }
    };

    // used by validators
    // returns true iff called at the start of the level (that is, on DummyMap)
    // returns false iff called by validateCallback (that is, on the actual map)
    this.isStartOfLevel = function () {
        return this._dummy;
    }

    /* canvas-related stuff */

    this.getCanvasContext = function() {
        return $('#drawingCanvas')[0].getContext('2d');
    };

    this.getCanvasCoords = function(obj) {
        return {
            x: (obj.getX() + 0.5) * 600 / __game._dimensions.width,
            y: (obj.getY() + 0.5) * 500 / __game._dimensions.height
        };
    };

    this.getRandomColor = function(start, end) {
        var mean = [
            Math.floor((start[0] + end[0]) / 2),
            Math.floor((start[1] + end[1]) / 2),
            Math.floor((start[2] + end[2]) / 2)
        ];
        var std = [
            Math.floor((end[0] - start[0]) / 2),
            Math.floor((end[1] - start[1]) / 2),
            Math.floor((end[2] - start[2]) / 2)
        ];
        return ROT.Color.toHex(ROT.Color.randomize(mean, std));
    };

    this.createLine = function(start, end, callback) {
        __lines.push({'start': start, 'end': end, 'callback': callback});
    };

    this.testLineCollisions = function(player) {
        var threshold = 7;
        var playerCoords = this.getCanvasCoords(player);
        __lines.forEach(function (line) {
            if (pDistance(playerCoords.x, playerCoords.y,
                    line.start[0], line.start[1],
                    line.end[0], line.end[1]) < threshold) {
                line.callback(__player);
            }
        })
    };

    /* for DOM manipulation level */

    this.getDOM = function () {
        return __dom;
    }

    this.createFromDOM = function(dom) {
        __dom = dom;
    };

    this.updateDOM = function(dom) {
        __dom = dom;
    };

    this.overrideKey = function(keyName, callback) {
        this._overrideKeys[keyName] = callback;
    }

    /* initialization */

    this._reset();
}
