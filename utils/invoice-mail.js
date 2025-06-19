const Imap = require("imap");
// const MailParser = require("mailparser").MailParser;
const app = require("../app");
const simpleParser = require('mailparser').simpleParser;

var {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
  } = require("@aws-sdk/client-s3");
  const { promisify } = require('util');

  const BUCKET_NAME = "shoofi-spaces";
  const imapConfig = {
  user: "invoices@shoofi.app",
  password: "qqrdqeelnowmrfsc",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: {
    rejectUnauthorized: false,
  },
};

const imap = new Imap(imapConfig);
const searchAndFetch = async (searchString, req) => {

    return new Promise(async (resolve, reject) => {




  imap.once("ready", async () => {
    console.log("Connected to Gmail via IMAP");
    const appName = 'shoofi';
    const db = req.app.db[appName];
    const amazonConfig = await db.amazonconfigs.findOne({ app: "amazon" });

    // Open the INBOX folder
    imap.openBox("INBOX", true, (err) => {
      if (err) throw err;

      // Search for all unseen emails
      imap.search([["SUBJECT", `*${searchString}*`]], (searchErr, results) => {
        if (searchErr){ 
            throw searchErr;
        }else  if(!results || !results.length){
            console.log("The server didn't find any emails matching the specified criteria")
        }

        // Fetch each unseen email
        const fetch = imap.fetch(results, { bodies: "" });
        fetch.on("message", (msg, seqno) => {
          
            const chunks = [];

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                chunks.push(chunk);
              });
          
              stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                simpleParser(buffer, async (err, parsed) => {
                  if (err) {
                    console.error('Error parsing email:', err);
                    return;
                  }
          
                  console.log('Received email with subject:', parsed.subject);
                  const s3Client = new S3Client({
                    endpoint: "https://fra1.digitaloceanspaces.com", // Find your endpoint in the control panel, under Settings. Prepend "https://".
                    //forcePathStyle: false, // Configures to use subdomain/virtual calling format.
                    region: "FRA1", // Must be "us-east-1" when creating new Spaces. Otherwise, use the region in your endpoint (e.g. nyc3).
                    credentials: {
                      accessKeyId: amazonConfig["ID_KEY"], // Access key pair. You can create access key pairs using the control panel or API.
                      secretAccessKey: amazonConfig["SECRET_KEY"], // Secret access key defined through an environment variable.
                    },
                  });
          
                  for (let i = 0; i < parsed.attachments.length; i++) {
                    const attachment = parsed.attachments[i];
                    const filename = `attachment_${i}.${attachment.contentType.split('/')[1]}`;
                    const params = {
                        Bucket: BUCKET_NAME, // The path to the directory you want to upload the object to, starting with your Space name.
                        Key: `invoices/doc-${searchString}.pdf`, // Object key, referenced whenever you want to access this file later.
                        Body: attachment.content, // The object's contents. This variable is an object, not a string.
                        ACL: "public-read",
                        ContentDisposition:"inline",
                        ContentType:"application/pdf"
                      };
                      const data = await s3Client.send(new PutObjectCommand(params));

                      resolve(true)

                  }
                });
              });
            });
          
        });



        fetch.once("end", () => {
          console.log("No more emails to fetch");
          imap.end();
        });
      });
    });
  });
  imap.once("error", (err) => {
    console.error("IMAP connection error:", err);
  });

  imap.once("end", () => {
    console.log("IMAP connection ended");
  });
  imap.connect();
})
}

// Connect to the IMAP server
// imap.connect();

// Set up an interval to periodically check for new emails (e.g., every 5 minutes)
// setInterval(() => {
//   imap.connect();
// }, 5 * 60 * 1000);

saveInvoice = async function (docId,req) {
  await searchAndFetch(docId,req);
};

const invoiceMailService = {
  saveInvoice: saveInvoice,
};
module.exports = invoiceMailService;
