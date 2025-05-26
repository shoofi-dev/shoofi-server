const { WebSocketServer } = require("ws");
const APP_CONSTS = require("../consts/consts");

const clients = new Map();

const getUserIdFromRequest = (req) => {
  const params = new URLSearchParams(req.url.split("?")[1]);
  const customerId = params.get("customerId");
  return customerId;
};

initWebSockets = function (server) {
  const wsServer = new WebSocketServer({ server });
  wsServer.on("connection", function (connection, req) {
    const userId = getUserIdFromRequest(req);
    // if (!userId) {
    //   return;
    // }

    clients.set(userId, connection);
    clients.forEach((value, key) => {
      console.log("websoclet-clients.set", `${key}`);
    });

    connection.on("close", () => {
      if (!userId) {
        return;
      }
      clients.delete(userId);
      clients.forEach((value, key) => {
        console.log("websoclet-clients.delete", `${key}`);
      });

    });

    connection.on("error", () => {
      if (!userId) {
        return;
      }
      clients.delete(userId);
    });
  });
};
fireWebscoketEvent = function ({
  type = "general",
  data = {},
  customersIds = null,
  isAdmin = false,
  appName = "",
}) {
  const message = JSON.stringify({ type: type, data: data });

  if (customersIds) {
    customersIds.forEach((customerId) => {
      console.log("websoclet-customersIds", customerId);

      let client = clients.getId(`${APP_CONSTS.SARI_APPS_DB_LIST.includes(appName)? appName : 'shoofi'}__${customerId}`);
      if (client) {
        client.send(message);
      }
    });
  }
  if (isAdmin) {
    clients.forEach((value, key) => {
      console.log("websoclet-key", key);
      if (value && key && key.includes(appName) && key.includes("admin")) {
        if (value) {
          value.send(message);
        }
      }
    });
  }
  if (!isAdmin && !customersIds) {
    clients.forEach((value, key) => {
      console.log("key", key);
      if (value && key && key.includes(appName) && key.includes(appName)) {
        console.log("key", key);
        if (value) {
          value.send(message);
        }
      }
    });
  }

  // clients.forEach((value, key) => {
  //   console.log("websocket-free", key);
  //     console.log("websocket-free", key);
  //     if (value) {
  //       value.send(message);
  //     }
  // });
};

setInterval(() => {
  clients?.forEach((ws, key) => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  });
}, 30000);

const websocket = {
  fireWebscoketEvent: fireWebscoketEvent,
  initWebSockets: initWebSockets,
};
module.exports = websocket;
