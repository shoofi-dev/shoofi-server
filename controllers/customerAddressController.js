const { ObjectId } = require('mongodb');

// Helper: build address object
function buildAddress(body) {
  return {
    _id: new ObjectId(),
    name: body.name,
    street: body.street,
    city: body.city,
    cityId: body.selectedCity ? new ObjectId(body.selectedCity?._id) : undefined,
    location: body.location, // { type: "Point", coordinates: [lng, lat] }
    floorNumber: body.floorNumber,
    streetNumber: body.streetNumber,
    selectedCity: body.selectedCity,
    notes: body.notes,
    isDefault: !!body.isDefault,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}


exports.addAddress = async (req, res) => {
  const db = req.app.db['shoofi'];
  const { customerId } = req.params;
  const address = buildAddress(req.body);

  try {
    if (address.isDefault) {
      // Unset all other defaults
      await db.customers.updateOne(
        { _id: ObjectId(customerId) },
        { $set: { 'addresses.$[].isDefault': false } }
      );
    }
    await db.customers.updateOne(
      { _id: ObjectId(customerId) },
      { $push: { addresses: address } }
    );
    res.status(200).json(address);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add address', details: err.message });
  }
};

exports.getAddresses = async (req, res) => {
  const db = req.app.db['shoofi'];
  const { customerId } = req.params;
  try {
    const customer = await db.customers.findOne({ _id: ObjectId(customerId) }, { projection: { addresses: 1 } });
    res.json(customer?.addresses || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get addresses', details: err.message });
  }
};

exports.updateAddress = async (req, res) => {
  const db = req.app.db['shoofi'];
  const { customerId, addressId } = req.params;
  const updateFields = { ...req.body, updatedAt: new Date() };
  if (updateFields.cityId) updateFields.cityId = ObjectId(updateFields.cityId);
  delete updateFields._id;
  try {
    if (updateFields.isDefault) {
      // Unset all other defaults
      await db.customers.updateOne(
        { _id: ObjectId(customerId) },
        { $set: { 'addresses.$[].isDefault': false } }
      );
    }
    await db.customers.updateOne(
      { _id: ObjectId(customerId), 'addresses._id': ObjectId(addressId) },
      { $set: Object.fromEntries(Object.entries(updateFields).map(([k, v]) => [`addresses.$.${k}`, v])) }
    );
    res.json({ message: 'Address updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update address', details: err.message });
  }
};

exports.deleteAddress = async (req, res) => {
  const db = req.app.db['shoofi'];
  const { customerId, addressId } = req.params;
  try {
    await db.customers.updateOne(
      { _id: ObjectId(customerId) },
      { $pull: { addresses: { _id: ObjectId(addressId) } } }
    );
    res.json({ message: 'Address deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete address', details: err.message });
  }
};

exports.setDefaultAddress = async (req, res) => {
  const db = req.app.db['shoofi'];
  const { customerId, addressId } = req.params;
  try {
    // Unset all defaults
    await db.customers.updateOne(
      { _id: ObjectId(customerId) },
      { $set: { 'addresses.$[].isDefault': false } }
    );
    // Set the selected address as default
    await db.customers.updateOne(
      { _id: ObjectId(customerId), 'addresses._id': ObjectId(addressId) },
      { $set: { 'addresses.$.isDefault': true, 'addresses.$.updatedAt': new Date() } }
    );
    res.json({ message: 'Default address set' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set default address', details: err.message });
  }
};