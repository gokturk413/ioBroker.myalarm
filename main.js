'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load required modules
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Myalarm extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'myalarm',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        
        // Initialize database
        const dbPath = path.join(this.adapterDir, 'alarms.db');
        this.db = new sqlite3.Database(dbPath);
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        // Subscribe to all states including foreign ones
        this.subscribeForeignStates('*');
        this.subscribeStates('*');

        // Create alarms table if it doesn't exist
        this.db.run(`CREATE TABLE IF NOT EXISTS alarms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            datapoint TEXT NOT NULL,
            alarm_type TEXT CHECK(alarm_type IN ('warning', 'info', 'alarm')) NOT NULL,
            high_value REAL,
            high_high_value REAL,
            low_value REAL,
            low_low_value REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create alarmlog table if it doesn't exist
        this.db.run(`CREATE TABLE IF NOT EXISTS alarmlog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Tagname STRING,
            Alarmtype STRING,
            Description VARCHAR,
            LimitValue INTEGER,
            Limitmessage STRING,
            HIGH_LOW STRING,
            AlarmTime INTEGER,
            AlarmValue VARCHAR,
            Acknowledge STRING,
            AcknowledgeTime INTEGER
        )`);

        // Set connection state to true
        this.setState('info.connection', true, true);

        // Create alarm info states
        await this.setObjectNotExistsAsync('info.AcknowledgeId', {
            type: 'state',
            common: {
                name: 'Acknowledge ID',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.AlarmJson', {
            type: 'state',
            common: {
                name: 'Alarm JSON',
                type: 'string',
                role: 'json',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.AlarmMessage', {
            type: 'state',
            common: {
                name: 'Alarm Message',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.AlarmSound', {
            type: 'state',
            common: {
                name: 'Alarm Sound',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.AlarmType', {
            type: 'state',
            common: {
                name: 'Alarm Type',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.IsAlarm', {
            type: 'state',
            common: {
                name: 'Is Alarm Active',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });

        // Alarm states will be created per datapoint in custom properties

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
        await this.setObjectNotExistsAsync('testVariable', {
            type: 'state',
            common: {
                name: 'testVariable',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        this.subscribeStates('testVariable');
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates('lights.*');
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates('*');

        /*
            setState examples
            you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        //await this.setStateAsync('testVariable', true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        //await this.setStateAsync('testVariable', { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        //await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        let result = await this.checkPasswordAsync('admin', 'iobroker');
        this.log.info('check user admin pw iobroker: ' + result);

        /*result = await this.checkGroupAsync('admin', 'admin');
        this.log.info('check group user admin group admin: ' + result);*/
        
        // Initialize AlarmJson with current unacknowledged alarms
        this.updateAlarmJson();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Close database connection
            if (this.db) {
                this.db.close();
            }
            callback();
        } catch (e) {
            this.log.error(`Error during unload: ${e}`);
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    /**
     * Add alarm log entry to database
     * @param {string} tagName
     * @param {string} alarmType
     * @param {string} description
     * @param {number} limitValue
     * @param {string} limitMessage
     * @param {string} highLow
     * @param {number} alarmTime
     * @param {string|number} value
     * @param {string} acknowledge
     */
    dbAddLogAlarm(tagName, alarmType, description, limitValue, limitMessage, highLow, alarmTime, value, acknowledge) {
        this.db.run(
            `INSERT INTO alarmlog (Tagname, Alarmtype, Description, LimitValue, Limitmessage, HIGH_LOW, AlarmTime, AlarmValue, Acknowledge)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tagName, alarmType, description, limitValue, limitMessage, highLow, alarmTime, value.toString(), acknowledge],
            (err) => {
                if (err) {
                    this.log.error(`Error adding alarm log: ${err.message}`);
                } else {
                    this.log.info(`Added alarm log for ${tagName}`);
                    // Update AlarmJson when new alarm is added
                    this.updateAlarmJson();
                }
            }
        );
    }

    /**
     * Update alarm acknowledge status when alarm is normalized
     * @param {string} tagName
     * @param {string} highLow
     */
    dbUpdateAlarmAcknowledge(tagName, highLow) {
        const acknowledgeTime = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        
        // First find the most recent unacknowledged alarm
        this.db.get(
            `SELECT id FROM alarmlog 
             WHERE Tagname = ? AND HIGH_LOW = ? AND Acknowledge = 'unack'
             ORDER BY AlarmTime DESC
             LIMIT 1`,
            [tagName, highLow],
            (err, row) => {
                if (err) {
                    this.log.error(`Error finding alarm to acknowledge: ${err.message}`);
                } else if (row) {
                    // Update the found alarm
                    this.db.run(
                        `UPDATE alarmlog 
                         SET Acknowledge = 'ack', AcknowledgeTime = ?
                         WHERE id = ?`,
                        [acknowledgeTime, row.id],
                        (updateErr) => {
                            if (updateErr) {
                                this.log.error(`Error updating alarm acknowledge: ${updateErr.message}`);
                            } else {
                                this.log.info(`Updated alarm acknowledge for ${tagName} - ${highLow}`);
                                // Update AlarmJson when alarm is acknowledged
                                this.updateAlarmJson();
                            }
                        }
                    );
                } else {
                    this.log.debug(`No unacknowledged alarm found for ${tagName} - ${highLow}`);
                }
            }
        );
    }


    dbUpdateLogAlarmAck(alarmid) {
        const moment = require('moment');
        const formattedDate = moment().valueOf();
        const contondate = moment(formattedDate).format('LLL');

        let jsondb;
        //const db = new sqlite3.Database(__dirname + '/lib/alarms/alarm.db');

        const data = [alarmid];
        // open the database connection
        const sql = 'UPDATE alarmlog SET  Acknowledge=\'ack\',AcknowledgeTime='+formattedDate+'  WHERE id = ?';
        // output the INSERT statement
        this.db.run(sql,data, function(err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`Rows inserted ${this.changes}`);
        });
        this.updateAlarmJson();
        // close the database connection
        //this.db.close();
    }

    dbgetLogAlarmFull(startdate,enddate,callback) {
        let jsondb;
                   
        const sql='SELECT id,Tagname,Alarmtype, datetime(AlarmTime/1000,\'unixepoch\',\'localtime\') as alarmtimeconverted, date(AlarmTime/1000,\'unixepoch\',\'localtime\') as alarmdateconverted,Description,LimitValue,Limitmessage,HIGH_LOW,AlarmTime,AlarmValue,Acknowledge, datetime(AcknowledgeTime/1000,\'unixepoch\',\'localtime\') as acknowledgetime  FROM alarmlog WHERE alarmtimeconverted BETWEEN ? AND ? ORDER BY AlarmTime DESC';
            this.db.all(sql,[ startdate, enddate ], (err, row) =>
            {
                if (err)
                {
                //throw err;
                    return console.error(err.message);
                }
                jsondb=JSON.stringify(row);
                callback(err, jsondb);
            });
    }

    dbgetLogAlarmLimit50(callback) {
        let jsondb;
                   
        const sql='SELECT id,Tagname,Alarmtype, datetime(AlarmTime/1000,\'unixepoch\',\'localtime\') as alarmtimeconverted, date(AlarmTime/1000,\'unixepoch\',\'localtime\') as alarmdateconverted,Description,LimitValue,Limitmessage,HIGH_LOW,AlarmTime,AlarmValue,Acknowledge, datetime(AcknowledgeTime/1000,\'unixepoch\',\'localtime\') as acknowledgetime  FROM alarmlog ORDER BY AlarmTime DESC LIMIT 50';
            this.db.all(sql, (err, row) =>
            {
                if (err)
                {
                //throw err;
                    return console.error(err.message);
                }
                jsondb=JSON.stringify(row);
                callback(err, jsondb);
            });
    }
    /**
     * Check alarm conditions and trigger if needed
     * @param {string} id
     * @param {number | null} value
     * @param {object} config
     */
    async checkAlarmCondition(id, value, config) {
        if (value === null || value === undefined) return;

        const moment = require('moment');
        const formattedDate = moment().valueOf();
        const contondate = moment(formattedDate).format('LLL');

        // Get the datapoint object to access custom properties
        const obj = await this.getForeignObjectAsync(id);
        if (!obj || !obj.common || !obj.common.custom || !obj.common.custom['myalarm.' + this.instance]) {
            return;
        }

        const customConfig = obj.common.custom['myalarm.' + this.instance];

        // Check HighHigh alarm
        if (config.highHighValue && value >= config.highHighValue) {
            // Only trigger if no existing highHigh alarm
            if (!customConfig.highHighAlarmValue) {
                // Set alarm state to 1 (active)
                customConfig.highHighAlarmValue = 1;
                await this.extendForeignObjectAsync(id, {
                    common: {
                        custom: {
                            ['myalarm.' + this.instance]: customConfig
                        }
                    }
                });
                
                this.handleAlarmTrigger(id, 'highHigh', value, config);
                this.dbAddLogAlarm(
                    id,                     // TagName
                    config.alarmType,      // AlarmType
                    config.description,    // Description
                    config.highHighValue,  // LimitValue
                    config.highMessage,    // LimitMessage
                    'highHigh',           // HIGH_LOW
                    formattedDate,        // AlarmTime
                    value,                // AlarmValue
                    'unack'               // Acknowledge
                );
            }
        } else if (config.highValue && value >= config.highValue) {
            // Only trigger if no existing high alarm
            if (!customConfig.highAlarmValue) {
                // Set alarm state to 1 (active)
                customConfig.highAlarmValue = 1;
                await this.extendForeignObjectAsync(id, {
                    common: {
                        custom: {
                            ['myalarm.' + this.instance]: customConfig
                        }
                    }
                });
                
                this.handleAlarmTrigger(id, 'high', value, config);
                this.dbAddLogAlarm(
                    id,                     // TagName
                    config.alarmType,      // AlarmType
                    config.description,    // Description
                    config.highValue,      // LimitValue
                    config.highMessage,    // LimitMessage
                    'high',               // HIGH_LOW
                    formattedDate,        // AlarmTime
                    value,                // AlarmValue
                    'unack'               // Acknowledge
                );
            }
        } else if (config.lowValue && value <= config.lowValue) {
            // Only trigger if no existing low alarm
            if (!customConfig.lowAlarmValue) {
                // Set alarm state to 1 (active)
                customConfig.lowAlarmValue = 1;
                await this.extendForeignObjectAsync(id, {
                    common: {
                        custom: {
                            ['myalarm.' + this.instance]: customConfig
                        }
                    }
                });
                
                this.handleAlarmTrigger(id, 'low', value, config);
                this.dbAddLogAlarm(
                    id,                     // TagName
                    config.alarmType,      // AlarmType
                    config.description,    // Description
                    config.lowValue,       // LimitValue
                    config.lowMessage,     // LimitMessage
                    'low',                // HIGH_LOW
                    formattedDate,        // AlarmTime
                    value,                // AlarmValue
                    'unack'               // Acknowledge
                );
            }
        } else if (config.lowLowValue && value <= config.lowLowValue) {
            // Only trigger if no existing lowLow alarm
            if (!customConfig.lowLowAlarmValue) {
                // Set alarm state to 1 (active)
                customConfig.lowLowAlarmValue = 1;
                await this.extendForeignObjectAsync(id, {
                    common: {
                        custom: {
                            ['myalarm.' + this.instance]: customConfig
                        }
                    }
                });
                
                this.handleAlarmTrigger(id, 'lowLow', value, config);
                this.dbAddLogAlarm(
                    id,                     // TagName
                    config.alarmType,      // AlarmType
                    config.description,    // Description
                    config.lowLowValue,    // LimitValue
                    config.lowMessage,     // LimitMessage
                    'lowLow',             // HIGH_LOW
                    formattedDate,        // AlarmTime
                    value,                // AlarmValue
                    'unack'               // Acknowledge
                );
            }
        } else {
            // Value is back to normal range, reset all alarm states to 0 and acknowledge alarms
            let needsUpdate = false;
            
            if (customConfig.highHighAlarmValue) {
                // Acknowledge the alarm in database
                this.dbUpdateAlarmAcknowledge(id, 'highHigh');
                customConfig.highHighAlarmValue = 0;
                needsUpdate = true;
            }
            if (customConfig.highAlarmValue) {
                // Acknowledge the alarm in database
                this.dbUpdateAlarmAcknowledge(id, 'high');
                customConfig.highAlarmValue = 0;
                needsUpdate = true;
            }
            if (customConfig.lowAlarmValue) {
                // Acknowledge the alarm in database
                this.dbUpdateAlarmAcknowledge(id, 'low');
                customConfig.lowAlarmValue = 0;
                needsUpdate = true;
            }
            if (customConfig.lowLowAlarmValue) {
                // Acknowledge the alarm in database
                this.dbUpdateAlarmAcknowledge(id, 'lowLow');
                customConfig.lowLowAlarmValue = 0;
                needsUpdate = true;
            }
            
            if (needsUpdate) {
                await this.extendForeignObjectAsync(id, {
                    common: {
                        custom: {
                            ['myalarm.' + this.instance]: customConfig
                        }
                    }
                });
                
                // Check if any alarms are still active globally
                await this.checkGlobalAlarmStatus();
            }
        }
    }

    /**
     * Check if any alarms are active across all datapoints and update global alarm status
     */
    async checkGlobalAlarmStatus() {
        try {
            // Get all objects with myalarm custom config
            const objects = await this.getForeignObjectsAsync('*', 'state');
            let hasActiveAlarm = false;
            
            for (const [objId, obj] of Object.entries(objects)) {
                if (obj && obj.common && obj.common.custom && obj.common.custom['myalarm.' + this.instance]) {
                    const customConfig = obj.common.custom['myalarm.' + this.instance];
                    
                    // Check if any alarm state is active (1)
                    if (customConfig.highHighAlarmValue || 
                        customConfig.highAlarmValue || 
                        customConfig.lowAlarmValue || 
                        customConfig.lowLowAlarmValue) {
                        hasActiveAlarm = true;
                        break;
                    }
                }
            }
            
            // Update global alarm status
            if (!hasActiveAlarm) {
                this.setState('info.IsAlarm', false, true);
                this.setState('info.AlarmMessage', '', true);
                this.setState('info.AlarmSound', '', true);
                this.setState('info.AlarmType', '', true);
                this.log.info('All alarms cleared - global alarm status set to false');
            }
        } catch (error) {
            this.log.error(`Error checking global alarm status: ${error.message}`);
        }
    }

    /**
     * Update AlarmJson state with unacknowledged alarms from database
     */
    updateAlarmJson() {
        this.db.all(
            `SELECT id, Tagname, Alarmtype, Description, LimitValue, Limitmessage, HIGH_LOW, AlarmTime, AlarmValue, Acknowledge
             FROM alarmlog 
             WHERE Acknowledge = 'unack'
             ORDER BY AlarmTime DESC`,
            [],
            (err, rows) => {
                if (err) {
                    this.log.error(`Error reading unacknowledged alarms: ${err.message}`);
                } else {
                    // Convert to JSON format
                    const alarmData = rows.map(row => {
                        const date = new Date(row.AlarmTime * 1000);
                        const formattedTime = date.getFullYear() + '-' + 
                            String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                            String(date.getDate()).padStart(2, '0') + ' ' + 
                            String(date.getHours()).padStart(2, '0') + ':' + 
                            String(date.getMinutes()).padStart(2, '0') + ':' + 
                            String(date.getSeconds()).padStart(2, '0');
                        
                        return {
                            "id": row.id,
                            "Tagname": row.Tagname,
                            "Alarmtype": row.Alarmtype,
                            "alarmtime": formattedTime,
                            "Description": row.Description,
                            "LimitValue": row.LimitValue,
                            "Limitmessage": row.Limitmessage,
                            "HIGH_LOW": row.HIGH_LOW,
                            "AlarmTime": row.AlarmTime,
                            "AlarmValue": row.AlarmValue,
                            "Acknowledge": row.Acknowledge,
                            "Acknowledgetime": row.acknowledgeTime
                        };
                    });
                    
                    // Update state with JSON
                    const jsonString = JSON.stringify(alarmData, null, 2);
                    this.setState('info.AlarmJson', jsonString, true);
                    
                    this.log.debug(`Updated AlarmJson with ${alarmData.length} unacknowledged alarms`);
                }
            }
        );
    }

    /**
     * Handle alarm trigger
     * @param {string} id
     * @param {string} type
     * @param {number} value
     * @param {object} config
     */
    handleAlarmTrigger(id, type, value, config) {
        this.log.info(`Alarm triggered for ${id}: ${type} (${value})`);
        
        // Determine message and sound based on alarm type
        let message, sound;
        if (type === 'high' || type === 'highHigh') {
            message = config.highMessage;
            sound = config.highAlarmSound;
        } else {
            message = config.lowMessage;
            sound = config.lowAlarmSound;
        }

        // Set global alarm states
        this.setState('info.IsAlarm', true, true);
        this.setState('info.AlarmMessage', message || `${type} alarm for ${id}`, true);
        this.setState('info.AlarmSound', sound || 'default', true);
        this.setState('info.AlarmType', type, true);

        // Create alarm state
        /*const alarmId = `alarms.${id.replace(/\./g, '_')}`;
        this.setObjectNotExists(alarmId, {
            type: 'state',
            common: {
                name: `Alarm for ${id}`,
                type: 'boolean',
                role: 'indicator.alarm',
                read: true,
                write: false
            },
            native: {}
        }, () => {
            // Set alarm state to true
            this.setState(alarmId, true, true);
        });*/
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if(id=='myalarm.'+this.instance+'.info.AcknowledgeId') {
            if (state && state.val !== null && state.val !== undefined) {
                this.dbUpdateLogAlarmAck(state.val);
            }
        }
        if (state && !state.ack) {
            // Get object to check for alarm configuration
            this.getForeignObject(id, async (err, obj) => {
                if (!err && obj && obj.common && obj.common.custom && 
                    obj.common.custom['myalarm.' + this.instance]) {
                    
                    const alarmConfig = obj.common.custom['myalarm.' + this.instance];
                    if (alarmConfig.enabled === true && alarmConfig.alarmActive === true) {
                        // Read all alarm parameters
                        const config = {
                            alarmType: alarmConfig.alarmType,
                            highValue: alarmConfig.highValue,
                            description: alarmConfig.description,
                            highHighValue: alarmConfig.highHighValue,
                            lowValue: alarmConfig.lowValue,
                            lowLowValue: alarmConfig.lowLowValue,
                            highMessage: alarmConfig.highMessage,
                            highAlarmSound: alarmConfig.highAlarmSound,
                            lowMessage: alarmConfig.lowMessage,
                            lowAlarmSound: alarmConfig.lowAlarmSound
                        };
                        
                        // Check alarm conditions with the new value
                        let numValue = null;
                        if (state.val !== null && state.val !== undefined) {
                            numValue = parseFloat(state.val.toString());
                            if (!isNaN(numValue)) {
                                await this.checkAlarmCondition(id, numValue, config);
                            }
                        }
                    }
                }
            });
        }
    }

    /**
     * Handle incoming messages from admin
     * @param {ioBroker.Message} obj
     */
    onMessage(obj) {
        if (obj.command === 'ackAlarm') {
            let alldata="";
            // e.g. send email or pushover or whatever
             this.log.info('send command');
             this.dbUpdateLogAlarmAck(obj.message.alarmId);
             // Set IsAlarm state to false when acknowledging alarm
             this.setState('info.IsAlarm', false, true);
             this.setState('info.AlarmType', {val: '0', ack: true});
             this.setState('info.AlarmSound', {val: '0', ack: true});
             this.setState('info.AlarmMessage', {val: 0, ack: true});
         }

        if (obj.command === 'getlog') {
            let alldata="";
            // e.g. send email or pushover or whatever
             this.log.info('send command');
             this.dbgetLogAlarmFull(obj.message.startdate,obj.message.enddate, (err, all) => {
                alldata= all;
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, all, obj.callback);
                }
            });
         }

         if (obj.command === 'getloglimit50') {
            let alldata="";
            // e.g. send email or pushover or whatever
             this.log.info('send command');
             this.dbgetLogAlarmLimit50( (err, all) => {
                alldata= all;
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, all, obj.callback);
                }
            });
         }

        if (typeof obj === 'object') {
            this.log.info(`Received message: ${JSON.stringify(obj)}`);
            
            if (obj.command) {
                switch (obj.command) {
                    case 'addAlarm':
                        //this.addAlarm(obj);
                        break;
                    case 'getAlarms':
                        //this.getAlarms(obj);
                        break;
                    case 'deleteAlarm':
                        //this.deleteAlarm(obj);
                        break;
                    case 'getSoundsName':
                        if (obj.callback) {
                            this.getSoundsName(obj);
                        }
                        break;
                    default:
                        this.log.warn(`Unknown command: ${obj.command}`);
                }
            }
        }
    }


    /**
     * Get list of available sound files for selectSendTo
     * @param {ioBroker.Message} obj - Message object from admin
     */
    getSoundsName(obj) {
        try {
            const sounds = [];
            const soundsfolder = path.join(__dirname, 'admin', 'sounds');
            const fs = require('fs');

            // Create sounds directory if it doesn't exist
            if (!fs.existsSync(soundsfolder)) {
                fs.mkdirSync(soundsfolder, { recursive: true });
                this.log.info('Created sounds directory: ' + soundsfolder);
            }

            // Add a default 'None' option
            sounds.push({
                label: 'None',
                value: ''
            });

            // Read sound files
            const files = fs.readdirSync(soundsfolder);
            files.forEach(file => {
                if (file.match(/\.(mp3|wav|ogg)$/i)) { // Only audio files
                    sounds.push({
                        label: file.replace(/\.(mp3|wav|ogg)$/i, ''),  // Remove file extension for display
                        value: file
                    });
                }
            });

            // Send the list back to the admin interface
            this.sendTo(obj.from, obj.command, sounds, obj.callback);
        } catch (error) {
            this.log.error('Error in getSoundsName: ' + error);
            // Send empty list on error
            this.sendTo(obj.from, obj.command, [], obj.callback);
        }
    }


}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Myalarm(options);
} else {
    // otherwise start the instance directly
    new Myalarm();
}