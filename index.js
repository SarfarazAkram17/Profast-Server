require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Profast server is cooking");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.or0q8ig.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const decoded = Buffer.from(process.env.FIREBASE_ADMIN_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    await client.connect();

    const db = client.db("Profast");

    const usersCollection = db.collection("usersCollection");
    const parcelCollection = db.collection("parcelCollection");
    const paymentsCollection = db.collection("paymentsCollection");
    const ridersCollection = db.collection("ridersCollection");
    // const trackingCollection =  db.collection("trackingCollection");

    // custom middleware
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req?.headers?.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;

        next();
      } catch (error) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
    };

    const verifyTokenUid = (req, res, next) => {
      const uidFromQuery = req?.query?.uid;
      const uidFromToken = req?.decoded?.uid;

      if (uidFromQuery !== uidFromToken) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      next();
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.query.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }

      next();
    };

    // creating payment intent
    app.post(
      "/create-payment-intent",
      verifyFBToken,
      verifyTokenUid,
      async (req, res) => {
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: req.body.amountInCents,
            currency: "bdt",
            payment_method_types: ["card"],
          });
          res.json({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      }
    );

    // users api
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ role: user.role });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get(
      "/users/search",
      verifyFBToken,
      verifyTokenUid,
      verifyAdmin,
      async (req, res) => {
        const emailQuery = req.query.email;
        if (!emailQuery) {
          return res.status(400).send({ message: "Missing email query" });
        }

        const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

        try {
          const users = await usersCollection
            .find({
              email: { $regex: regex },
              role: { $in: ["admin", "user"] },
            })
            .limit(10)
            .toArray();

          res.send(users);
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;

      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        const updateResult = await usersCollection.updateOne(
          { email },
          { $set: { last_log_in: new Date().toISOString() } }
        );

        return res.status(200).send({
          message: "User already exists, last_log_in updated",
          updated: updateResult.modifiedCount > 0,
        });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyTokenUid,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!["admin", "user"].includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );
          res.send({ message: `User role updated to ${role}`, result });
        } catch (error) {
          res.status(500).send({ message: error.message });
        }
      }
    );

    // parcels api
    app.get("/parcels", verifyFBToken, verifyTokenUid, async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { created_by: email } : {};

        const options = {
          creation_date: -1,
        };

        const result = await parcelCollection.find(query, options).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch parcels" });
      }
    });

    app.get("/parcels/:id", verifyFBToken, verifyTokenUid, async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };

        const result = await parcelCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch parcel by ID" });
      }
    });

    app.post("/parcels", verifyFBToken, verifyTokenUid, async (req, res) => {
      try {
        const parcel = req.body;

        const result = await parcelCollection.insertOne(parcel);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to make parcel" });
      }
    });

    app.delete(
      "/parcels/:id",
      verifyFBToken,
      verifyTokenUid,
      async (req, res) => {
        try {
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };

          const result = await parcelCollection.deleteOne(query);
          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Failed to delete parcel" });
        }
      }
    );

    // tracking api
    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send(result);
    });

    // payments api
    app.get("/payments", verifyFBToken, verifyTokenUid, async (req, res) => {
      try {
        const email = req.query.email;

        const query = email ? { email } : {};

        const options = { sort: { paid_at: -1 } };

        const payments = await paymentsCollection
          .find(query, options)
          .toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ message: "Failed to get payments" });
      }
    });

    app.post("/payments", verifyFBToken, verifyTokenUid, async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } =
          req.body;

        // 1. Update parcel's payment_status
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Parcel not found or already paid" });
        }

        // 2. Insert payment record
        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: "Payment recorded and parcel marked as paid",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to record payment" });
      }
    });

    // riders api
    app.get(
      "/riders/pending",
      verifyFBToken,
      verifyTokenUid,
      verifyAdmin,
      async (req, res) => {
        try {
          const pendingRiders = await ridersCollection
            .find({ status: "pending" })
            .toArray();

          res.send(pendingRiders);
        } catch (error) {
          res.status(500).send({ message: "Failed to load pending riders" });
        }
      }
    );

    app.get(
      "/riders/active",
      verifyFBToken,
      verifyTokenUid,
      verifyAdmin,
      async (req, res) => {
        try {
          const activeRiders = await ridersCollection
            .find({ status: "active" })
            .toArray();

          res.send(activeRiders);
        } catch (error) {
          res.status(500).send({ message: "Failed to load active riders" });
        }
      }
    );

    app.post("/riders", verifyFBToken, verifyTokenUid, async (req, res) => {
      const rider = req.body;

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch(
      "/riders/:id/status",
      verifyFBToken,
      verifyTokenUid,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status, email } = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status,
          },
        };

        try {
          const result = await ridersCollection.updateOne(query, updatedDoc);

          if (status === "active") {
            const userQuery = { email };
            const updatedDoc = {
              $set: {
                role: "rider",
              },
            };
            const updatedRoleResult = await usersCollection.updateOne(
              userQuery,
              updatedDoc
            );
          }
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to update rider status" });
        }
      }
    );

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Profast server running on port ${port}`);
});
