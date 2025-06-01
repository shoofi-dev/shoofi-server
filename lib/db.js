const MongoClient = require('mongodb').MongoClient;
const mongodbUri = require('mongodb-uri');
const DatabaseInitializationService = require('../services/database/DatabaseInitializationService');

let _db = {};

async function initDb(callback) {
    if(Object.keys(_db).length != 0){
        console.warn('Trying to init DB again!');
        return callback(null, _db);
    }

    const client = new MongoClient(process.env.DB_CONNECTION_STRING, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();

    // First initialize the shoofi database to get store app names
    const shoofiDb = client.db('shoofi');
    const stores = await shoofiDb.collection('stores').find({}, { projection: { appName: 1 } }).toArray();
    const dbList = ['delivery-company', 'shoofi', ...stores.map(store => store.appName)];

    for(let i = 0; i < dbList.length; i++) {
        // Set the DB url
        const dbUrl = getDbUri('mongodb://127.0.0.1:27017/' + dbList[i]);

        // select DB
        const dbUriObj = mongodbUri.parse(dbUrl);

        // Set the DB depending on ENV
        const db = await DatabaseInitializationService.initializeDatabase(dbUriObj.database, client);
        _db[dbList[i]] = db;
    }
    return callback(null, _db);
}

function getDbUri(dbUrl){
    const dbUriObj = mongodbUri.parse(dbUrl);
    // if in testing, set the testing DB
    if(process.env.NODE_ENV === 'test'){
        dbUriObj.database = 'expresscart-test';
    }
    return mongodbUri.format(dbUriObj);
}

function getDb(){
    return _db;
}

module.exports = {
    getDb,
    initDb,
    getDbUri
};
