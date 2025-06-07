class DatabaseInitializationService {
  static async initializeDatabase(databaseName, client) {
    const db = client.db(databaseName);
    
    // Setup collections for the database
    db.users = db.collection('users');
    db.categories = db.collection('categories');
    db.generalCategories = db.collection('general-categories');
    db.products = db.collection('products');
    db.variants = db.collection('variants');
    db.orders = db.collection('orders');
    db.transactions = db.collection('transactions');
    db.pages = db.collection('pages');
    db.menu = db.collection('menu');
    db.customers = db.collection('customers');
    db.cart = db.collection('cart');
    db.sessions = db.collection('sessions');
    db.discounts = db.collection('discounts');
    db.reviews = db.collection('reviews');
    db.amazonconfigs = db.collection('amazonconfigs');
    db.smsHistory = db.collection('smsHistory');
    db.locationPolygon = db.collection('location-polygon');
    db.store = db.collection('store');
    db.calander = db.collection('calander');
    db.courses = db.collection('courses');
    db.teachers = db.collection('teachers');
    db.clientError = db.collection('client-error');
    db.bookDelivery = db.collection('book-delivery');
    db.downloadAppQr = db.collection('download-app-qr');
    db.translations = db.collection('translations');
    db.images = db.collection('images');
    db.stores = db.collection('stores');
    db.extras = db.collection('extras');
    db.areas = db.collection('areas');
    db.cities = db.collection('cities');

    return db;
  }
}

module.exports = DatabaseInitializationService; 