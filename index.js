const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

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

    // add user to db
    app.post("/add-user", async (req, res) => {
      const userinfo = req.body;
      console.log(userinfo);

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
    // get user
    app.get("/user", async (req, res) => {
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
    });

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

        console.log("Donor Search Query:", query);

        const donors = await usersCollection.find(query).toArray();

        console.log("Donors found:", donors.length);

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
      console.log(updatedData);

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

    // update donation request
    app.patch("/donation-requests/:id/donate", async (req, res) => {
      const { id } = req.params;
      const donorInfo = req.body; // { donorName, donorEmail }

      try {
        const updateResult = await requestsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status: "inprogress",
              donar: {
                donorName: donorInfo.donorName,
                donorEmail: donorInfo.donorEmail,
              },
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(400).send({
            message:
              "Unable to confirm donation. It may have already been claimed.",
          });
        }

        res.send({ message: "Donation confirmed. Status set to inprogress." });
      } catch (err) {
        res
          .status(500)
          .send({ message: "Error updating request.", error: err });
      }
    });

    // blogs
    // add blog
    app.post("/blogs", async (req, res) => {
      const blog = req.body;

      blog.createdAt = new Date().toISOString();
      blog.status = "published";

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
        const blogs = await blogsCollection
          .find({ status: "published" })
          .toArray();
        res.send(blogs);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch blogs." });
      }
    });
    // get blog details
    app.get("/blogs/:id", async (req, res) => {
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

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
