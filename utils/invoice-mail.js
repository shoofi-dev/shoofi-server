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
  user: "customerinvoices@shoofi.app",
  password: "gzoqdsvcjfkulgac",
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
      if (err) {
        console.error("Error opening INBOX:", err);
        imap.end();
        return reject(err);
      }

      // Search for all unseen emails
      imap.search([["SUBJECT", `*${searchString}*`]], (searchErr, results) => {
        if (searchErr) {
            console.error("Error searching emails:", searchErr);
            imap.end();
            return reject(searchErr);
        }else  if(!results || !results.length){
            console.log("The server didn't find any emails matching the specified criteria")
            imap.end();
            return resolve(false);
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
    imap.end();
    return reject(err);
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

saveInvoice = async function (docId, req, maxRetries = 3, initialDelay = 5000) {
  let attempt = 0;
  let delay = initialDelay;
  
  while (attempt < maxRetries) {
    try {
      console.log(`Attempt ${attempt + 1}/${maxRetries} to save invoice for docId: ${docId}`);
      
      const result = await searchAndFetch(docId, req);
      
      if (result === true) {
        console.log(`Successfully saved invoice for docId: ${docId} on attempt ${attempt + 1}`);
        return true;
      } else {
        console.log(`No invoice email found for docId: ${docId} on attempt ${attempt + 1}`);
      }
      
    } catch (error) {
      console.error(`Error on attempt ${attempt + 1} for docId ${docId}:`, error);
    }
    
    attempt++;
    
    if (attempt < maxRetries) {
      console.log(`Waiting ${delay}ms before retry ${attempt + 1} for docId: ${docId}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff: double the delay for next attempt
      delay = Math.min(delay * 2, 60000); // Cap at 1 minute for immediate processing
    }
  }
  
  console.log(`Failed to save invoice for docId: ${docId} after ${maxRetries} attempts - will be queued for background processing`);
  return false;
};

// Queue for pending invoice processing
const pendingInvoices = new Map();

// Background processor for invoices
const processPendingInvoices = async () => {
  for (const [docId, { req, attempts, lastAttempt }] of pendingInvoices.entries()) {
    const now = Date.now();
    const timeSinceLastAttempt = now - lastAttempt;
    
    // More aggressive retry for background processing (shorter delays)
    const delay = Math.min(5000 * Math.pow(1.5, attempts), 120000); // 5s to 2min
    
    if (timeSinceLastAttempt >= delay) {
      try {
        console.log(`Background processing invoice for docId: ${docId}, attempt ${attempts + 1}`);
        
        const result = await searchAndFetch(docId, req);
        
        if (result === true) {
          console.log(`Successfully processed invoice for docId: ${docId} in background`);
          
          // Update order status to completed
          try {
            const appName = req.headers["app-name"] || "shoofi";
            const db = req.app.db[appName];
            
            await db.orders.updateOne(
              { "ccPaymentRefData.docId": docId },
              {
                $set: {
                  "ccPaymentRefData.invoiceStatus": "completed",
                  "ccPaymentRefData.processedAt": new Date()
                },
              },
              { multi: false }
            );
          } catch (updateError) {
            console.error("Failed to update order status after background processing:", updateError);
          }
          
          pendingInvoices.delete(docId);
        } else {
          // Update attempt count and last attempt time
          pendingInvoices.set(docId, { req, attempts: attempts + 1, lastAttempt: now });
          
          // Remove from queue if max attempts reached (more attempts for background)
          if (attempts + 1 >= 10) {
            console.error(`Max attempts reached for docId: ${docId}, removing from queue`);
            pendingInvoices.delete(docId);
            
            // Update order status to failed
            try {
              const appName = req.headers["app-name"] || "shoofi";
              const db = req.app.db[appName];
              
              await db.orders.updateOne(
                { "ccPaymentRefData.docId": docId },
                {
                  $set: {
                    "ccPaymentRefData.invoiceStatus": "failed",
                    "ccPaymentRefData.lastAttempt": new Date()
                  },
                },
                { multi: false }
              );
            } catch (updateError) {
              console.error("Failed to update order status after max attempts:", updateError);
            }
          }
        }
      } catch (error) {
        console.error(`Background processing error for docId: ${docId}:`, error);
        pendingInvoices.set(docId, { req, attempts: attempts + 1, lastAttempt: now });
      }
    }
  }
};

// Start background processor - more frequent for better responsiveness
setInterval(processPendingInvoices, 15000); // Check every 15 seconds instead of 30

// Add invoice to background processing queue
const queueInvoiceForProcessing = (docId, req) => {
  pendingInvoices.set(docId, { req, attempts: 0, lastAttempt: Date.now() });
  console.log(`Queued invoice for background processing: ${docId}`);
  return true;
};

// Check if invoice is pending
const isInvoicePending = (docId) => {
  return pendingInvoices.has(docId);
};

// Get pending invoices count
const getPendingInvoicesCount = () => {
  return pendingInvoices.size;
};

// Manual trigger for invoice processing (can be called via webhook)
const triggerInvoiceProcessing = async (docId, req) => {
  try {
    console.log(`Manually triggering invoice processing for docId: ${docId}`);
    
    // Remove from pending queue if it exists
    pendingInvoices.delete(docId);
    
    // Attempt immediate processing
    const result = await searchAndFetch(docId, req);
    
    if (result === true) {
      console.log(`Successfully processed invoice for docId: ${docId} via manual trigger`);
      
      // Update order status if we have the request context
      if (req && req.app && req.app.db) {
        try {
          const appName = req.headers["app-name"] || "shoofi";
          const db = req.app.db[appName];
          
          await db.orders.updateOne(
            { "ccPaymentRefData.docId": docId },
            {
              $set: {
                "ccPaymentRefData.invoiceStatus": "completed",
                "ccPaymentRefData.processedAt": new Date()
              },
            },
            { multi: false }
          );
        } catch (updateError) {
          console.error("Failed to update order status after manual processing:", updateError);
        }
      }
      
      return true;
    } else {
      console.log(`Invoice not found for docId: ${docId} via manual trigger, queuing for background processing`);
      queueInvoiceForProcessing(docId, req);
      return false;
    }
  } catch (error) {
    console.error(`Error in manual invoice processing for docId: ${docId}:`, error);
    // Queue for background processing as fallback
    queueInvoiceForProcessing(docId, req);
    return false;
  }
};

// Test function to demonstrate the improved flow
const testInvoiceFlow = async (docId, req) => {
  console.log(`=== Testing Invoice Flow for docId: ${docId} ===`);
  
  // Simulate immediate processing attempt
  console.log("1. Attempting immediate processing...");
  const immediateResult = await saveInvoice(docId, req);
  
  if (immediateResult) {
    console.log("✅ Invoice processed immediately - user gets instant response!");
    return true;
  } else {
    console.log("⏳ Invoice not found immediately - queuing for background processing");
    queueInvoiceForProcessing(docId, req);
    console.log("✅ User gets instant response while invoice processes in background");
    return false;
  }
};

const invoiceMailService = {
  saveInvoice: saveInvoice,
  queueInvoiceForProcessing: queueInvoiceForProcessing,
  isInvoicePending: isInvoicePending,
  getPendingInvoicesCount: getPendingInvoicesCount,
  triggerInvoiceProcessing: triggerInvoiceProcessing,
  testInvoiceFlow: testInvoiceFlow, // For testing
};
module.exports = invoiceMailService;
