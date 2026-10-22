const { schedule } = require("@netlify/functions");
const { checkAndNotifySubscribers, connectToDB } = require("../server");

module.exports.handler = schedule("@hourly", async () => {
  await connectToDB();
  await checkAndNotifySubscribers();

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Subscriber notifications checked." }),
  };
});
