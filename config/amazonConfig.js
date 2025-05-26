const mongoose = require('mongoose');

const { Schema } = mongoose;
//Amazon
const AmazonConfigModel = new Schema({
    ID_KEY: String,
    SECRET_KEY: String
}, 
{ timestamps: true });


mongoose.model('AmazonConfig', AmazonConfigModel);