const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.SAK_FIREBASE, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("bloodGrid_DB");
    const usersCollection = db.collection("users");
    const requestsCollection = db.collection("requests");
    const blogsCollection = db.collection("blogs");
    const paymentsCollection = db.collection("payments");

    // custom middlewares
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeaders = req.headers.authorization;
      if (!authHeaders) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = authHeaders.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized access." });
      }

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (err) {
        res.status(403).send({ message: "Forbidden access." });
      }
    };
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;

      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access." });
      }
      next();
    };
    const verifyAdminVolunteer = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res
            .status(401)
            .send({ message: "Unauthorized access: No email in token." });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || (user.role !== "admin" && user.role !== "volunteer")) {
          return res
            .status(403)
            .send({ message: "Forbidden access: Admin or Volunteer only." });
        }

        next();
      } catch (error) {
        console.error("Error verifying admin/volunteer:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    };

    const verifyVolunteer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "volunteer") {
        return res.status(403).send({ message: "Forbidden access." });
      }
      next();
    };
    const verifyEmailQueryMatch = (req, res, next) => {
      const queryEmail = req.query.email;
      const decodedEmail = req.decoded?.email;
      if (!queryEmail || queryEmail !== decodedEmail) {
        return res
          .status(403)
          .json({ message: "Forbidden access: Email mismatch" });
      }

      next();
    };
    const verifyEmailMatch = (req, res, next) => {
      const paramEmail = req.params.email;
      const decodedEmail = req.decoded?.email;

      if (paramEmail !== decodedEmail) {
        return res
          .status(403)
          .json({ message: "Forbidden access: Email mismatch" });
      }

      next();
    };

    // add user to db
    app.post("/add-user", async (req, res) => {
      const userinfo = req.body;
      userinfo.createAt = new Date().toISOString();
      userinfo.loginAt = new Date().toISOString();
      userinfo.role = "donor";
      userinfo.status = "active";

      try {
        const result = await usersCollection.insertOne(userinfo);
        res.status(201).send({
          insertedId: result.insertedId,
          acknowledged: result.acknowledged,
          message: "User has been added successfully.",
        });
      } catch (err) {
        console.error("User insertion error:", err);
        res.status(500).send({ message: "Failed to add the user." });
      }
    });
    // user login update

    app.patch("/users/:email/last-login", async (req, res) => {
      const { email } = req.params;

      try {
        const result = await usersCollection.updateOne(
          { email },
          {
            $set: {
              loginAt: new Date().toISOString(),
            },
          }
        );

        res.json({ modified: result.modifiedCount > 0 });
      } catch (error) {
        res.status(500).json({ error: "Failed to update last login" });
      }
    });

    // get user
    app.get(
      "/user",
      verifyFirebaseToken,
      verifyEmailQueryMatch,
      async (req, res) => {
        const email = req.query.email;
        try {
          const user = await usersCollection.findOne({ email });
          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }
          res.send(user);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch user", error: err });
        }
      }
    );

    // get user role
    app.get("/user-role", async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ error: "Email query is required." });
      }

      try {
        const query = { email };
        const user = await usersCollection.findOne(query);

        if (!user) {
          return res.status(404).send({ error: "User not found." });
        }

        res.send({ role: user.role });
      } catch (err) {
        console.error("Error fetching user role:", err);
        res.status(500).send({ error: "Failed to fetch user role." });
      }
    });
    // get donor by search
    app.get("/donors", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;

        if (!bloodGroup || !district || !upazila) {
          return res.status(400).json({ message: "All fields are required." });
        }

        const query = {
          bloodGroup,
          district,
          upazila,
          role: "donor",
          status: "active",
        };

        const donors = await usersCollection.find(query).toArray();

        res.status(200).json(donors);
      } catch (err) {
        console.error("Error fetching donors:", err);
        res.status(500).json({ message: "Failed to fetch donors" });
      }
    });

    // user update
    app.put("/user/update/:email", async (req, res) => {
      const { email } = req.params;
      const updatedData = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updatedData }
        );

        if (result.modifiedCount > 0) {
          res.send({ message: "Profile updated successfully" });
        } else {
          res
            .status(404)
            .send({ message: "User not found or no changes made" });
        }
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to update profile", error: err });
      }
    });

    // donation
    // create donation request
    app.post("/donation-requests", async (req, res) => {
      const requestData = req.body;
      requestData.createdAt = new Date().toISOString();
      requestData.status = "pending";

      try {
        const result = await requestsCollection.insertOne(requestData);
        res.status(201).send({
          ...result,
          message: "Donation request has been created.",
        });
      } catch (err) {
        console.error("Error creating donation request:", err.message);

        res.status(500).send({
          message: "Failed to create donation request.",
          error: err.message, // optional: remove in production for security
        });
      }
    });
    // get pending donation req
    app.get("/donation-requests", async (req, res) => {
      const status = req.query.status;
      const query = status ? { status } : {};
      const result = await requestsCollection.find(query).toArray();
      res.send(result);
    });
    // get donation req details
    app.get("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const request = await requestsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!request) {
          return res
            .status(404)
            .send({ message: "Donation request not found." });
        }
        res.send(request);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Error retrieving request.", error: err });
      }
    });
    // get my donation
    app.get(
      "/my-donation-requests/user",
      verifyFirebaseToken,
      verifyEmailQueryMatch,
      async (req, res) => {
        const { email, status, page = 1, limit = 5 } = req.query;
        const parsedLimit = parseInt(limit);
        const skip = (parseInt(page) - 1) * parsedLimit;

        const query = { requesterEmail: email };
        if (status) query.status = status;

        const total = await requestsCollection.countDocuments(query);
        const requests = await requestsCollection
          .find(query)
          .skip(skip)
          .limit(parsedLimit)
          .sort({ createdAt: -1 })
          .toArray();

        res.send({
          requests,
          totalPages: Math.ceil(total / parsedLimit),
        });
      }
    );
    // update donation request
    app.patch("/donation-requests/:id/donate", async (req, res) => {
      const { id } = req.params;
      const { status, donorName, donorEmail } = req.body;

      const updateFields = {};

      if (status) updateFields.status = status;
      if (donorName && donorEmail) {
        updateFields.donor = {
          name: donorName,
          email: donorEmail,
        };
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).send({
          message: "Nothing to update. Provide status or donor info.",
        });
      }

      try {
        const updateResult = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(400).send({
            message:
              "No changes applied. The request might not exist or is already updated.",
          });
        }

        res.send({
          message: "Donation request updated successfully.",
        });
      } catch (err) {
        res.status(500).send({
          message: "Error updating donation request.",
          error: err,
        });
      }
    });

    app.patch("/donation-requests/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      try {
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send(result);
      } catch (error) {
        console.error("Update Error:", error);
        res.status(500).send({ error: "Failed to update donation request" });
      }
    });

    app.get(
      "/request-status-count",
      verifyFirebaseToken,
      verifyEmailQueryMatch,
      async (req, res) => {
        const { email } = req.query;
        try {
          const result = await requestsCollection
            .aggregate([
              {
                $match: { requesterEmail: email },
              },
              {
                $facet: {
                  statusBreakdown: [
                    {
                      $group: {
                        _id: "$status",
                        count: { $sum: 1 },
                      },
                    },
                  ],
                  total: [{ $count: "total" }],
                },
              },
            ])
            .toArray();

          res.send(result[0]);
        } catch (error) {
          console.error("Aggregation error:", error);
          res.status(500).send({ error: "Failed to aggregate status counts." });
        }
      }
    );
    // admin dashboard
    app.get("/admin/dashboard-stats", verifyFirebaseToken, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalDonationRequests = await requestsCollection.countDocuments();
        const funds = await paymentsCollection
          .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray();

        const totalFunds = funds[0]?.total || 0;

        res.send({
          totalUsers,
          totalDonationRequests,
          totalFunds,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load stats", error });
      }
    });

    app.get(
      "/admin/users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { page = 1, limit = 10, status = "all" } = req.query;
          const filter = status !== "all" ? { status } : {};

          const users = await usersCollection
            .find(filter)
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .toArray();

          const total = await usersCollection.countDocuments();

          res.send({
            users,
            totalPages: Math.ceil(total / limit),
            total,
          });
        } catch (error) {
          res.status(500).send({ error: "Failed to fetch users." });
        }
      }
    );

    // admin
    app.get(
      "/admin/donation-requests",
      verifyFirebaseToken,
      verifyAdminVolunteer,
      async (req, res) => {
        try {
          const { page = 1, limit = 10, status = "all" } = req.query;
          const filter = status !== "all" ? { status } : {};

          const requests = await requestsCollection
            .find(filter)
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .toArray();

          const total = await requestsCollection.countDocuments();

          res.send({
            requests,
            totalPages: Math.ceil(total / limit),
          });
        } catch (error) {
          console.error(error);
          res.status(500).send({ error: "Failed to fetch donation requests." });
        }
      }
    );

    app.patch("/admin/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        if (!updates || (!updates.role && !updates.status)) {
          return res.status(400).send({ error: "No valid fields to update." });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: {} };

        if (updates.role) {
          updateDoc.$set.role = updates.role;
        }
        if (updates.status) {
          updateDoc.$set.status = updates.status;
        }

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found." });
        }

        res.send({
          message: "User updated successfully.",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to update user." });
      }
    });

    // delete request
    app.delete("/donation-requests/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }

      try {
        const result = await requestsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Donation request not found" });
        }

        res
          .status(200)
          .json({ message: "Donation request deleted successfully" });
      } catch (error) {
        console.error("Error deleting donation request:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // blogs
    // add blog
    app.post("/blogs", async (req, res) => {
      const blog = req.body;

      blog.createdAt = new Date().toISOString();
      blog.status = "draft";

      try {
        const result = await blogsCollection.insertOne(blog);
        res.status(201).send({
          insertedId: result.insertedId,
          acknowledged: result.acknowledged,
          message: "Blog has been added successfully.",
        });
      } catch (err) {
        console.error("Blog insertion error:", err);
        res.status(500).send({ message: "Failed to add the blog." });
      }
    });

    // get blog
    app.get("/blogs", async (req, res) => {
      try {
        const { role, status } = req.query;

        let filter = {};

        if (role === "admin" || role === "volunteer") {
          if (status) {
            filter.status = status;
          }
        } else {
          filter.status = "published";
        }

        const blogs = await blogsCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(blogs);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch blogs." });
      }
    });
    // update status
    app.patch("/blogs/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updatedFields = req.body;

        const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
          return res.status(404).send({ message: "Blog not found" });
        }

        const statusInUpdate = Object.prototype.hasOwnProperty.call(
          updatedFields,
          "status"
        );
        const statusChanged =
          statusInUpdate && updatedFields.status !== blog.status;

        if (!statusChanged) {
          updatedFields.updatedAt = new Date().toISOString();
        }

        const result = await blogsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Blog not found" });
        }

        res.send({ modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Error updating blog:", error);
        res.status(500).send({ message: "Failed to update blog" });
      }
    });

    // delete blog
    app.delete("/blogs/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await blogsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to delete blog." });
      }
    });

    // blog state
    app.get("/blogs/stats", verifyFirebaseToken, async (req, res) => {
      try {
        const result = await blogsCollection
          .aggregate([
            {
              $facet: {
                statusBreakdown: [
                  { $group: { _id: "$status", count: { $sum: 1 } } },
                ],
                total: [{ $count: "total" }],
              },
            },
            {
              $project: {
                statusBreakdown: 1,
                total: { $arrayElemAt: ["$total.total", 0] },
              },
            },
          ])
          .toArray();

        res.send(result[0]);
      } catch (error) {
        console.error("Error fetching blog stats:", error);
        res.status(500).send({ error: "Failed to fetch blog stats." });
      }
    });

    // get blog details
    app.get("/blogs/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      try {
        const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
          return res.status(404).send({ error: "Blog not found." });
        }
        res.send(blog);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch blog." });
      }
    });

    // Create a payment intent endpoint
    app.post("/api/create-payment-intent", async (req, res) => {
      try {
        const { amount, currency = "usd" } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency,
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    // save payment
    app.post("/api/save-payment", async (req, res) => {
      try {
        const { paymentIntentId, amount, email } = req.body;

        if (!paymentIntentId || !amount || !email) {
          return res.status(400).json({ message: "Missing payment details" });
        }

        const paymentData = {
          paymentIntentId,
          email,
          amount,
          paidAt: new Date().toISOString(),
          status: "completed",
        };

        const result = await paymentsCollection.insertOne(paymentData);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Save payment error:", error);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });
    // get payment details
    app.get(
      "/fundraiser-payments",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const payments = await paymentsCollection
          .find()
          .sort({ paidAt: -1 })
          .toArray();
        res.send(payments);
      }
    );

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// sample route
app.get("/", (req, res) => {
  res.send("BloodGrid server is cooking...");
});

// start the route
app.listen(port, () => {
  console.log(`server is listening on port ${port}`);
});
