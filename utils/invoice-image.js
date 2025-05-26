const { createCanvas, loadImage } = require('canvas');
// const Canvas = require('canvas');

async function generateOrderImage(orderData) {
    // const canvas = createCanvas(400, 300);
    // const ctx = canvas.getContext('2d');
    // ctx.textAlign = 'center';
    // ctx.textBaseline = "middle";

    // // let base_image = new Canvas.Image();
    // // base_image.src = '../assets/logos/pizza-gmel.png';
    // // base_image.onload = function(){
    // //     ctx.drawImage(base_image, 0, 0);
    // // }
    // ctx.fillStyle = 'white';
    // ctx.fillRect(0, 0, canvas.width, canvas.height);

    // // Set text color

    // ctx.fillStyle = 'black';
    // ctx.font = '24px Arial';

    // const image = await loadImage('assets/logos/pizza-gmel.png');
    //   ctx.drawImage(image,canvas.width/2 - 25,10, 50, 50)

// Initial canvas settings
const canvasWidth = 800;
const initialCanvasHeight = 600;
const lineHeight = 30;
const itemHeaderHeight = 30;
const halfItemHeight = 30;
const totalHeightOffset = 50;
const dashedLineOffset = 10; // Offset for dashed lines

// Function to draw centered text
function drawCenteredText(ctx, text, y, canvasWidth) {
  const textWidth = ctx.measureText(text).width;
  const x = (canvasWidth - textWidth) / 2;
  ctx.fillText(text, x, y);
}

// Calculate dynamic height based on the number of items
let requiredHeight = 50 + 6 * lineHeight + totalHeightOffset; // Initial details height
orderData.order.items.forEach(item => {
  requiredHeight += itemHeaderHeight;
  requiredHeight += Math.max(item.halfOne?.length || 0, item.halfTwo?.length || 0) * halfItemHeight;
  requiredHeight += lineHeight + dashedLineOffset + 30; // Gap between items and space for dashed line
});

// Create canvas with dynamic height
const canvas = createCanvas(canvasWidth, requiredHeight);
const ctx = canvas.getContext('2d');

// Set background color
ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Set text styles
ctx.fillStyle = '#000000';
ctx.font = '20px Arial';

    const image = await loadImage('assets/logos/pizza-gmel.png');
      ctx.drawImage(image,canvas.width/2 - 25,10, 50, 50)
// Draw order details
let yPosition = 100;
drawCenteredText(ctx, `Order ID: ${orderData.orderId}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Customer ID: ${orderData.customerId}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Payment Method: ${orderData.order.payment_method}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Receipt Method: ${orderData.order.receipt_method}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Order Date: ${orderData.orderDate}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Order Type: ${orderData.orderType}`, yPosition, canvasWidth);
yPosition += lineHeight;
drawCenteredText(ctx, `Total: ${orderData.total}`, yPosition, canvasWidth);
yPosition += lineHeight + 20;

drawCenteredText(ctx, `Items:`, yPosition, canvasWidth);
yPosition += lineHeight;

// Draw items and their halves
orderData.order.items.forEach((item, itemIndex) => {
  yPosition += 30;
  drawCenteredText(ctx, `${item.nameAR} - ${item.price}`, yPosition, canvasWidth);
  yPosition += lineHeight;

  const halfOneYPosition = yPosition;
  item.halfOne?.forEach((halfOneItem, index) => {
    const text = `${halfOneItem}`;
    const textWidth = ctx.measureText(text).width;
    const x = (canvas.width / 2 - textWidth) / 2;
    ctx.fillText(text, x, halfOneYPosition + index * halfItemHeight);
  });

  const halfTwoYPosition = yPosition;
  item.halfTwo?.forEach((halfTwoItem, index) => {
    const text = `${halfTwoItem}`;
    const textWidth = ctx.measureText(text).width;
    const x = (canvas.width / 2) + (canvas.width / 2 - textWidth) / 2;
    ctx.fillText(text, x, halfTwoYPosition + index * halfItemHeight);
  });

  const maxHalfRows = Math.max(item.halfOne?.length || 0, item.halfTwo?.length || 0);
  yPosition += (maxHalfRows * halfItemHeight) + 0;

  // Draw dashed line
  yPosition += dashedLineOffset / 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(50, yPosition);
  ctx.lineTo(canvasWidth - 50, yPosition);
  ctx.stroke();
  yPosition += dashedLineOffset / 2;
});

// Draw the total at the bottom
yPosition += lineHeight;
drawCenteredText(ctx, `Total: ${orderData.total}`, yPosition, canvasWidth);
    // Convert to Base64
    const base64Image = canvas.toDataURL().split(',')[1];
    return base64Image;
}



const orderInvoiceService = {
    createInvoice: generateOrderImage,
};
module.exports = orderInvoiceService;