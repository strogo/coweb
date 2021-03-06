//
// Test and debug utilities.
//
// Copyright (c) The Dojo Foundation 2011. All Rights Reserved.
// Copyright (c) IBM Corporation 2008, 2011. All Rights Reserved.
//
dojo.provide('tests.util');
dojo.require('coweb.jsoe.OperationEngine');

dojo.declare('tests.util.OpEngClient', null, {
    all_clients: [],

    constructor: function(site, state, keepFrozen) {
        this.eng = new coweb.jsoe.OperationEngine(site);
        this.state = state;
        this.incoming = [];
        this.all_clients.push(this);
        if(!keepFrozen) {
            dojo.forEach(this.all_clients, 'item.eng.thawSite('+site+');');
        }
    },

    send: function(op) {
        for(var i=0; i < this.all_clients.length; i++) {
            var client = this.all_clients[i];
            if(client != this)
                client.incoming.push(op);
        }
    },

    recv: function() {
        var op = this.incoming[0];
        this.incoming = this.incoming.slice(1);
        if(op) {
            this.remote(op);
            return true;
        }
        return false;
    },
    
    recvSome: function(count) {
        while(count-- > 0 && this.incoming.length) {
            this.recv();
        }
    },
    
    recvAll: function() {
        this.recvSome(this.incoming.length);
    },

    syncWith: function(client) {
        this.eng.pushSync(client.eng.siteId, client.eng.copyContextVector());
    },

    getStateFrom: function(client) {
        // copy site state
        this.state = {};
        for(var key in client.state) {
            this.state[key] = client.state[key];
        }
        // copy engine state
        // do json encode / decode to produce an independent copy easily
        // (and to test speed for real world scenario)
        var es = client.eng.getState();
        var json = dojo.toJson(es);
        es = dojo.fromJson(json);
        this.eng.setState(es);
    },

    purge: function() {
        return this.eng.purge();
    },

    local: function(key, value, type, position) {
        this._assertValid(key, value, type, position);
        var op = this.eng.push(true, key, value, type, position);
        this._updateState(op);
        return op;
    },

    remote: function(op) {
        // make a copy before transforming because everything is local here
        op = this.eng.pushRemoteOp(op.copy());
        this._updateState(op);
        return op;
    },
    
    remoteRaw: function(key, value, type, position, site, cv) {
        if(this.eng.siteId == site) {
            // ignore own incoming events
            return;
        }
        var op = this.eng.push(false, key, value, type, position, site, cv);
        this._updateState(op);
        return op;
    },
    
    _assertValid: function(key, value, type, position) {
        var curr = this.state[key];
        if(curr === undefined) throw new Error('invalid key for '+type);
        if(type == 'update') {
            // let -1 mean the whole shebang
            if(position >= curr.length || position < -1) {
                throw new Error('invalid position for update');
            }
        } else if(type == 'insert') {
            if(position > curr.length || position < 0) {
                throw new Error('invalid position for insert');
            }
        } else if(type == 'delete') {
            if(position >= curr.length || position < 0) {
                throw new Error('invalid position for delete');
            }        
        }
    },

    _updateState: function(op) {
        if(!op) {
            return;
        }
        var curr = this.state[op.key] || '';
        if(op.declaredClass == 'coweb.jsoe.UpdateOperation') {
            var p = op.position;
            if(p >= 0) {
                curr = curr.slice(0,p) + op.value + curr.slice(p+1);
            } else {
                curr = op.value;
            }
        } else if(op.declaredClass == 'coweb.jsoe.InsertOperation') {
            curr = curr.slice(0, op.position) + op.value + curr.slice(op.position);
        } else if(op.declaredClass == 'coweb.jsoe.DeleteOperation') {
            curr = curr.slice(0, op.position) + curr.slice(op.position+1);
        }
        this.state[op.key] = curr;
    }
});

tests.util.equals = function(obj1, obj2) {
    var util = tests.util;
    if (obj1.constructor !== obj2.constructor)
        return false;
    var aMemberCount = 0;
    var a;
    for (a in obj1) {
        if (!obj1.hasOwnProperty(a)) {continue;}
        if (typeof obj1[a] === 'object' && 
            typeof obj2[a] === 'object' ? 
            !util.equals(obj1[a], obj2[a]) : obj1[a] !== obj2[a]) {
            return false;
        }
        ++aMemberCount;
    }
    for (a in obj2) {
        if (obj2.hasOwnProperty(a)) {
            --aMemberCount;
        }
    }
    return aMemberCount ? false : true;
};

tests.util.replayOperations = function(log, keepFrozen) {
    var params = log.params;
    var history = log.history;

    var sites = [];
    // build all simulated sites
    for(var i=0; i < params.numSites; i++) {
        var state = {};
        // build initial state as strings
        for(var t=0; t < params.topics.length; t++) {
            var topic = params.topics[t];
            state[topic] = '';
        }
        sites.push(new coweb.util.OpEngClient(i, state, keepFrozen));
    }
    
    var tmpl = 'event {0} ({1}) at site {2}';
    // run events in order of occurrence except the last one
    return {
        typeMap : {
            UpdateOperation : 'update',
            InsertOperation : 'insert',
            DeleteOperation : 'delete'
        },
        total : history.length,
        sites : sites,
        curr : 0,
        next : function(n, skip) {
            var elem;
            n = n || 1;
            for(var i=this.curr; i < this.curr+n; i++) {
                elem = history[i];
                if(elem == undefined) { break; }
                console.log(dojo.replace(tmpl, [i, elem.action, elem.at]));
                if(!skip) {
                    this._doOp(elem, i);
                    this.dump();
                }
            }
            this.curr += n;
            elem = history[this.curr];
            if(elem) {
                console.log('[next: '+ 
                    dojo.replace(tmpl, [this.curr, elem.action, elem.at])+']');
            }
        },
        dump : function() {
            dojo.forEach(this.sites, function(site) {
                var eng = site.eng;
                console.log('siteId: ', eng.siteId);
                console.log('    state: ', dojo.toJson(site.state));
                console.log('    cv: ', eng.cv.toString());
                console.log('    history size: ', eng.hb.size);
            }, this);
        },
        _doOp : function(item, i) {
            var site = this.sites[item.at];
            if(item.action == 'purge') {
                return site.purge();
            } else if(item.action == 'send') {
                return site.local(item.topic, 
                    item.value, 
                    this.typeMap[item.type], 
                    item.position);
            } else if(item.action == 'recv') {
                return site.remoteRaw(item.topic, 
                    item.value, 
                    this.typeMap[item.type], 
                    item.position, 
                    item.siteId, 
                    dojo.fromJson(item.contextVector));
            }
        }
    };
};

tests.util.scriptOperations = function(log) {
    var params = log.params;
    var history = log.history;
    
    var script = ['var sites = [];', 'var op;'];
    // build all simulated sites
    for(var i=0; i < params.numSites; i++) {
        var state = {};
        // build initial state as strings
        for(var t=0; t < params.topics.length; t++) {
            var topic = params.topics[t];
            state[topic] = '';
        }
        state = dojo.toJson(state);
        script.push('sites.push(new coweb.util.OpEngClient('+i+','+state+'));');
    }

    var typeMap = {
        UpdateOperation : 'update',
        InsertOperation : 'insert',
        DeleteOperation : 'delete'
    };
    
    dojo.forEach(history, function(item) {
        var site = 'sites['+item.at+']';
        var tmpl, args = {site : site};
        if(item.action == 'purge') {
            tmpl = '{site}.purge();';
        } else if(item.action == 'send') {
            tmpl = 'op = {site}.local("{topic}", {value}, "{type}", {position});';
            args.topic = item.topic;
            args.value = item.value ? '"'+item.value+'"' : null;
            args.type = typeMap[item.type];
            args.position = item.position;
            script.push(dojo.replace(tmpl, args));
            tmpl = '{site}.send(op);';
            script.push(dojo.replace(tmpl, args));
        } else if(item.action == 'recv') {
            tmpl = '{site}.recv();';
            // args.topic = item.topic;
            // args.value = item.value;
            // args.type = typeMap[item.type];
            // args.position = item.position;
            // args.siteId = item.siteId;
            // args.contextVector = item.contextVector;
            script.push(dojo.replace(tmpl, args));
        }
    });
    return script.join('\n');
};

tests.util.randomOperations = function(numSites, toSend, topics, prob) {
    var log = {
        sites : [],
        history : [],
        params : {numSites : numSites, toSend : toSend, topics : topics, prob : prob}
    };
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    var randint = function(upper) {
        return Math.floor(Math.random()*upper);
    }
    var genUpdate = function(site, key) {
        var value = site.state[key];
        if(!value) {
            // can't do an update; no content
            return null;
        }
        // pick a random character to flip lower/upper
        var i = randint(value.length);
        if(value.charCodeAt(i) >= 97) {
            var ch = value.charAt(i).toUpperCase();
        } else {
            var ch = value.charAt(i).toLowerCase();
        }
        // apply the op locally
        return site.local(key, ch, 'update', i);
    };
    
    var genInsert = function(site, key) {
        var value = site.state[key];
        if(value.length >= 20) {
            // keep string length bounded for experimentation
            return null;
        }
        // pick a random letter
        var i = randint(letters.length);
        var ch = letters.charAt(i);
        // pick a random location
        i = randint(value.length);
        // apply the op locally
        return site.local(key, ch, 'insert', i);
    };
    
    var genDelete = function(site, key) {
        var value = site.state[key];
        if(value.length <= 0) {
            // can't delete; no content
            return null;
        }
        // pick a random location
        var i = randint(value.length);
        // apply the op locally
        return site.local(key, null, 'delete', i);
    };

    var ops = [genUpdate, genInsert, genDelete];
    var sites = log.sites;
    // build all simulated sites
    for(var i=0; i < numSites; i++) {
        var state = new Object();
        // build initial state as strings
        for(var t=0; t < topics.length; t++) {
            var topic = topics[t];
            state[topic] = '';
        }
        sites.push(new coweb.util.OpEngClient(i, state));
    }

    var toRecv = 0;
    var forceSend = false;

    // interleave sends and receives
    while(toSend > 0 || toRecv > 0) {
        var action, op=null;
        if(forceSend || (Math.random() < prob && toSend > 0)) {
            // pick a random site to send an event
            var sender = sites[randint(numSites)];
            // pick a random event
            while(op == null) {
                var gen = ops[randint(ops.length)];
                var topic = topics[randint(topics.length)];
                op = gen(sender, topic);
            }
            action = {
                action : 'send', 
                at : sender.eng.siteId,
                topic : op.key,
                value : op.value,
                type : op.declaredClass.split('.')[4],
                position : op.position,
                siteId : op.siteId,
                seqId : op.seqId,
                contextVector : op.contextVector.toString(),
                stateBefore : sender.state[op.key]
            };
            log.history.push(action);
            // propagate to all sites
            sender.send(op);
            action.stateAfter = sender.state[op.key];
            // decrease number of sends remaining in the test
            toSend--;
            // increase number to receive
            toRecv += numSites;
            forceSend = false;
        } else if(toRecv > 0) {
            // pick a random site to receive an op
            var recvr = sites[toRecv % numSites];
            op = recvr.incoming[0];
            if(op) {
                action = {
                    action : 'recv',
                    at : recvr.eng.siteId,
                    topic : op.key,
                    value : op.value,
                    type : op.declaredClass.split('.')[4],
                    position : op.position,
                    siteId : op.siteId,
                    seqId : op.seqId,
                    contextVector : op.contextVector.toString(),
                    stateBefore : recvr.state[op.key]
                };
                log.history.push(action);
                // receive the op
                action.handled = recvr.recv();
                action.stateAfter = recvr.state[op.key];
            }
            // decrease the number of outstanding receives
            toRecv--;
        } else {
            // do a random purge if we're not doing anything else
            var purger = sites[randint(sites.length)];
            action = {action : 'purge', at : purger.eng.siteId};
            log.history.push(action);
            var mcv = purger.purge();
            action.mcv = (mcv) ? mcv.toString() : mcv;
            // force a send as the next event since we're sitting idle
            forceSend = true;
        }
    }    
    return log;
};

tests.util.transformLog = function(name, line, context, scope, arguments) {
    if(context.search('_transform') > -1) {
        console.log('>', name, line, context);
        console.log('  siteId:', arguments[0].siteId, 'seqId:', arguments[0].seqId, 'cd:', arguments[1].getHistoryBufferKeys());
    } else if(context.search('transformWith') > -1) {
        var arr = dojo.map(arguments, 'return item;');
        console.log(name, line, context);
        dojo.forEach([scope, arr[0]], function(item) {
            console.log(item.declaredClass, 'siteId:', item.siteId, 'seqId:', item.seqId, 'contextVector:', item.contextVector.sites.toString(), 'origContextVector:', item.origContextVector.sites.toString(), 'value:', item.value, 'position:', item.position, 'origPosition:', item.origPosition);
        });
    }
};