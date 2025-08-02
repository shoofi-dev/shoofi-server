const APP_CONSTS = {
  USER_STATUS: {
    LEAD: "1",
    APPROVED: "2",
    PAID: "3",
  },
  NOTEFICATION_TYPES_WOF: {
    NEW_LEAD: "new_lead",
  },
 BRANCH_IDS: {
    1: "دبورية",
    2: "الطيبة",
  },
  SARI_APPS_DB_LIST: ['pizza-gmel', 'world-of-swimming', 'buffalo', 'delivery-company', 'abdelhai-butcher'],
  ORDER_STATUS: {
    IN_PROGRESS: "1",
    COMPLETED: "2",
    WAITING_FOR_DRIVER: "3",
    CANCELLED: "4",
    REJECTED: "5",
    PENDING: "6",
    CANCELLED_BY_ADMIN: "7",
    CANCELLED_BY_CUSTOMER: "8",
    CANCELLED_BY_DRIVER: "9",
    PICKED_UP: "10",
    PICKED_UP_BY_DRIVER: "11",
    DELIVERED: "12",
  },
  DELIVERY_STATUS: {
    WAITING_FOR_APPROVE: "1",
    APPROVED: "2",
    COLLECTED_FROM_RESTAURANT: "3",
    DELIVERED: "4",
    CANCELLED_BY_DRIVER: "-1",
    CANCELLED_BY_STORE: "-2",
    CANCELLED_BY_ADMIN: "-3",
  },
};



module.exports = APP_CONSTS;
