const axios = require('axios');
const moment = require("moment");
const cron = require("node-cron");
const APP_CONSTS = require("../consts/consts");

const apiPath = 'https://api.sms4free.co.il/ApiSMS/SendSMS';
const apiBalance = 'https://api.sms4free.co.il/ApiSMS/AvailableSMS';

sendSMS = async function ( phoneNumber, smsContent, req, db = null, appName = null) {
  let sms4freeSecret = null;
  if(req){
     sms4freeSecret = await req.app.db[req.headers['app-name']].amazonconfigs.findOne({app: "sms4free"});
  }else{
    sms4freeSecret = await db[appName || req.headers['app-name']].amazonconfigs.findOne({app: "sms4free"});
  }
  if(!sms4freeSecret.isActive){
    return;
  }
  const key = sms4freeSecret.SECRET_KEY;
  const user = sms4freeSecret.USER;
  const pass = sms4freeSecret.PASSWORD;
  const sender = sms4freeSecret.SENDER_NAME;

  const requestObject = {
    key ,
    user,
    pass,
    sender,
    recipient: phoneNumber,
    msg: smsContent
    }
    return axios.post(apiPath, requestObject, { 
        headers: {
          "Content-Type": 'application/json',
        }
     })
    .then(async (response) => {
        if(response.status === 200){
          const data = {
            smsContent: smsContent,
            phoneNumber: phoneNumber,
            created: new Date(),
            isSuccess: true
          };
        if(req && req.headers && req.headers['app-name']){
            await req.app.db[req.headers['app-name']].smsHistory.insertOne(data);
         }else{
          if(db){
            if(appName){
              await db[appName].smsHistory.insertOne(data);

            }else{
              await db.smsHistory.insertOne(data);
            }
          }
         }
        console.info('Successfully sent sms');
        }
    })
    .catch(async (err) => {
      console.log("SMS catch", err)
      const data = {
        smsContent: smsContent,
        error: err,
        phoneNumber: phoneNumber,
        created: new Date(),
        isSuccess: false
      };
      if(req){
        await req.app.db[appName || req.headers['app-name']].smsHistory.insertOne(data);
      }else{
        if(db){
          await db.smsHistory.insertOne(data);
        }
      }
     console.log('Error sending sms:', err);
    });
    
};

checkSMSBalance = async function (db) {

  const sms4freeSecret = await db.amazonconfigs.findOne({app: "sms4free"});
  const key = sms4freeSecret.SECRET_KEY;
  const user = sms4freeSecret.USER;
  const pass = sms4freeSecret.PASSWORD;

const requestObject = {
key,
user,
pass,
}

  // const activeTrailSecret = await db.amazonconfigs.findOne({app: "activetrail"});
  // const activeTrailSecretKey = activeTrailSecret.SECRET_KEY;
  // console.log("activeTrailSecretKey", activeTrailSecretKey);
    return axios.post(apiBalance, requestObject, { 
        headers: {
            "Content-Type": 'application/json',
          }
     })
    .then((response) => {
        if(response.status === 200){
            console.info('check sms balance', response);
            if(response.data< 300){
              const smsContent = getSMSBalanceContent(
                response.data
              );
              //smsService.sendSMS(customer.phone, smsContent, req);
              sendSMS("0542454362", smsContent, null, db);
            }
        }
    })
    .catch((err) => {
        console.log('Error sending sms:', err);
    });
}




getOrderRecivedContent = function (customerName, totalAmount, shippingMethod, orderId, lang) {
    const orderIdSplit = orderId.split("-");
    const idPart2 = orderIdSplit[2];
    if(lang == "0"){
      return `مرحبا ${customerName} \u{1F60A} \n ` 
      + `لقد تم استلام الطلبية بنجاح \u{2705} \n`
      + `اخترت ${shippingMethod == "TAKEAWAY" ? "الاستلام من المحل \u{1F6CD}" : "خدمة التوصيل \u{1F6E9}"}. \n `
      + `مبلغ الطلبية: ${totalAmount}₪ \n`

    }else{
      return `היי ${customerName} \u{1F60A} \n ` 
      + `ההזמנה התקבלה בהצלחה \u{2705} \n`
      + ` - שיטת איסוף ${shippingMethod == "TAKEAWAY" ? "איסוף עצמי \u{1F6CD}" : "משלוח \u{1F6E9}"} \n `
      + `מחיר לתשלום: ${totalAmount}₪ \n`
    }
}

getOrderTakeawayReadyContent = function (customerName, orderId, lang) {
  const orderIdSplit = orderId.split("-");
  const idPart2 = orderIdSplit[2];
  if(lang == "0"){
    return `مرحبا ${customerName} \u{1F60A} \n ` 
    + `الطلبية جاهزة للاستلام \u{2705} \n`
  }else{
    return `היי ${customerName} \u{1F60A} \n ` 
    + `ההזמנה מוכנה לאיסוף \u{2705} \n`
  }
}

getOrderDeliveryReadyContent = function (customerName, orderId, lang, orderCompanyNumber) {
  const orderIdSplit = orderId.split("-");
  const idPart2 = orderIdSplit[2];
  if(lang == "0"){
    return `مرحبا ${customerName} \u{1F60A} \n ` 
    + `الطلبية بطريقها اليك \u{1F6EB} \n`
    + `رقم المرسل :${orderCompanyNumber} \n`
  }else{
    return `היי ${customerName} \u{1F60A} \n ` 
    + `ההזמנה מוכנה, השליח בדרך אליך \u{1F6EB} \n`
    + `מספר השליח :${orderCompanyNumber} \n`
  }

}

getOrderDeliveryCompanyContent = function (customerName, orderId, lang,orderDate, phone, deliveryDeltaMinutes) {
  const orderIdSplit = orderId.split("-");
  const idPart2 = orderIdSplit[2];
  return `ساعة الاستلام ${moment(orderDate).subtract(deliveryDeltaMinutes, "minutes").utcOffset(120).format('HH:mm')}\n`
  + `رقم الطلبية ${idPart2} \n`
  + `اسم الزبون ${customerName} \n`
  + `هاتف الزبون ${phone} \n`
}

getOrderDeliveryCompanyCanceledContent = function (customerName,time, phone,price) {
  return `الغيت\n`
  + `ساعة الاستلام ${time}\n`
  + `اسم الزبون ${customerName} \n`
  + `هاتف الزبون ${phone} \n`
  + `السعر ${price} \n`
}

getCustomOrderDeliveryCompanyContent = function (customerName, phone,price, deliveryDeltaMinutes) {
  return `ساعة الاستلام: ${deliveryDeltaMinutes}\n`
  + `اسم الزبون: ${customerName} \n`
  + `هاتف الزبون: ${phone} \n`
  + `سعر الطلبية: ${price} \n`
}


getVerifyCodeContent = function (verifyCode, lang) {
  if(lang == "0"){
    return `الكود الخاص بك هو: ${verifyCode}`;
  }else{
    return `קוד האימות שלך הוא: ${verifyCode}`;
  }
}

getSMSBalanceContent = function (credits) {
    return `עדכן את חבילת ה סמס, נשארו: ${credits}`;
}

getOrderInvoiceContent = function (invoiceUrl) {
  return `מצורף לינק לחשבונית לצפייה: ${invoiceUrl}`;
}

wofLeadRegisterContent = function (customerName, phone, branchId, preferredDays) {
  return `تسجيل جديد:\n`
  + `الاسم: ${customerName} \n`
  + `الهاتف: ${phone} \n`
  + `الفرع: ${APP_CONSTS.BRANCH_IDS[branchId]} \n`
  + `الايام المفضلة: ${preferredDays.join(", ")} \n`
}
wofLeadAssignedToCourseContent = function (customerName, appleAppLink, androidAppLink, payLink) {
  return `مرحبا\n`
  + `الاسم: ${customerName} \n`
  + `الدفع عن طريق الرابط: ${payLink} \n`
  + `تحميل التطبيق: \n`
  + `ايفون: ${appleAppLink} \n`
  + `اندرويد: ${androidAppLink} \n`
}

const smsService = {
    sendSMS: sendSMS,
    getOrderRecivedContent: getOrderRecivedContent,
    getOrderInvoiceContent: getOrderInvoiceContent,
    getVerifyCodeContent: getVerifyCodeContent,
    getOrderTakeawayReadyContent: getOrderTakeawayReadyContent,
    getOrderDeliveryReadyContent: getOrderDeliveryReadyContent,
    getOrderDeliveryCompanyContent: getOrderDeliveryCompanyContent,
    getOrderDeliveryCompanyCanceledContent: getOrderDeliveryCompanyCanceledContent,
    getCustomOrderDeliveryCompanyContent: getCustomOrderDeliveryCompanyContent,
    checkSMSBalance: checkSMSBalance,
    wofLeadRegisterContent: wofLeadRegisterContent,
    wofLeadAssignedToCourseContent: wofLeadAssignedToCourseContent,
};
module.exports = smsService;
