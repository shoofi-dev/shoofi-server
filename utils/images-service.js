var {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const BUCKET_NAME = "creme-caramel-images";

const uploadImage = async (files, req, folderName) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  const amazonConfig = await db.amazonconfigs.findOne({ app: "amazon" });
  let locationslist = [];
  let counter = 0;

  return new Promise((resolve, reject) => {
    const s3Client = new S3Client({
      endpoint: "https://fra1.digitaloceanspaces.com", // Find your endpoint in the control panel, under Settings. Prepend "https://".
      //forcePathStyle: false, // Configures to use subdomain/virtual calling format.
      region: "FRA1", // Must be "us-east-1" when creating new Spaces. Otherwise, use the region in your endpoint (e.g. nyc3).
      credentials: {
        accessKeyId: amazonConfig["ID_KEY"], // Access key pair. You can create access key pairs using the control panel or API.
        secretAccessKey: amazonConfig["SECRET_KEY"], // Secret access key defined through an environment variable.
      },
    });
    files = files.filter((file) => file.originalname !== "existingImage");
    console.log("X3");
    if (files.length > 0) {
      files.forEach(async (file, i) => {
        const fileName = `${new Date().getTime()}` + file.originalname;
        const folder = folderName || "products";
        const params = {
          Bucket: BUCKET_NAME, // The path to the directory you want to upload the object to, starting with your Space name.
          Key: `${folder}/${fileName}`, // Object key, referenced whenever you want to access this file later.
          Body: file.buffer, // The object's contents. This variable is an object, not a string.
          ACL: "public-read",
        };

        try {
          const data = await s3Client.send(new PutObjectCommand(params));
          locationslist.push({ uri: params.Key });
          counter++;
          if (counter === files.length) {
            resolve(locationslist);
          }
        } catch (err) {
          console.log("Error", err);
        }
      });
    } else {
      resolve(locationslist);
    }
  });
};

const imagesService = {
  uploadImage: uploadImage,
};
module.exports = imagesService;
