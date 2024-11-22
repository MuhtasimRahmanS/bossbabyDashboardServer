// Importing required modules
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const moment = require("moment");

// Initialize the Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware Setup
app.use(
  cors({
    origin: ["http://localhost:5174"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

// MongoDB connection string and client setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kaoye.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB client instance
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Function to start the server and handle database operations
async function run() {
  try {
    // MongoDB collection reference
    const productCollection = client.db("bossbaby").collection("allProduct");
    const orderCollection = client.db("bossbaby").collection("allOrders");

    // API endpoints

    app.get("/products", async (req, res) => {
      try {
        const { search = "", category = "", page = 1, limit = 10 } = req.query;

        // Calculate the number of documents to skip for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Create a filter to match the search term in the product name and category
        const filter = {
          ...(search && { name: { $regex: search, $options: "i" } }), // Case-insensitive search
          ...(category && { category }), // Filter by category if provided
        };

        // Fetch products from the collection, sorted by descending order (bottom to top)
        const products = await productCollection
          .find(filter)
          .sort({ _id: -1 }) // Sort by _id in descending order
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        // Get the total count of documents that match the filter
        const totalCount = await productCollection.countDocuments(filter);

        // Send the products and total count as the response
        res.status(200).json({
          products,
          totalCount,
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
        });
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Error fetching products", error });
      }
    });

    // API endpoint to add a new product
    app.post("/products", async (req, res) => {
      const { name, category, type, color, sizes, images } = req.body;

      try {
        // Create a new product object
        const newProduct = {
          name,
          category,
          type: type || null,
          color,
          sizes,
          images,
          createdAt: new Date(),
        };

        // Insert the new product into the database
        const result = await productCollection.insertOne(newProduct);
        res.status(201).json({
          message: "Product added successfully",
          productId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).json({
          message: "Error adding product",
          error: error.message,
        });
      }
    });

    // API endpoint to update a product
    app.patch("/products/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      try {
        const result = await productCollection.updateOne(
          { _id: new ObjectId(id) }, // Ensure you are looking up by ObjectId
          { $set: updateData } // Update only the fields that were sent in the request body
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Product not found or no changes made" });
        }

        res.status(200).json({ message: "Product updated successfully" });
      } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ message: "Error updating product", error });
      }
    });

    //Api endpoint to delete a product
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.deleteOne(query);
      res.send(result);
    });

    ///

    // Get all orders with optional search, date filtering, and pagination

    app.get("/api/orders", async (req, res) => {
      try {
        const { search, startDate, endDate, after } = req.query;
        const query = {};

        // Search by customer name, phone number, or partial _id
        if (search) {
          query.$or = [
            { name: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$_id" },
                  regex: search,
                  options: "i",
                },
              },
            },
          ];
        }

        // Date range filtering
        if (startDate || endDate) {
          query.orderDate = {};

          if (startDate) {
            // Parse startDate as ISO 8601 for date comparison
            query.orderDate.$gte = new Date(
              moment(startDate).startOf("day").toISOString()
            );
          }

          if (endDate) {
            // Parse endDate as ISO 8601, set to end of day to include the whole date
            query.orderDate.$lte = new Date(
              moment(endDate).endOf("day").toISOString()
            );
          }
        }

        // Pagination using last order ID
        if (after && ObjectId.isValid(after)) {
          query._id = { $gt: new ObjectId(after) };
        }

        // Fetch total count for the given filter
        const totalOrders = await orderCollection.countDocuments(query);

        // Fetch filtered orders, sorted by orderDate (descending)
        const orders = await orderCollection
          .find(query)
          .sort({ orderDate: -1 })
          .limit(10)
          .toArray();

        res.json({ orders, totalOrders });
      } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ message: "Error fetching orders" });
      }
    });

    ///

    app.put("/api/orders/:orderId/status", async (req, res) => {
      const { orderId } = req.params;
      const { status } = req.body;

      try {
        const order = await orderCollection.findById(orderId);

        if (!order) {
          return res.status(404).json({ message: "Order not found." });
        }

        // Update the order status
        order.status = status;
        await order.save();

        res
          .status(200)
          .json({ message: "Order status updated successfully.", order });

        // Handle stock update if status is 'return'
        if (status === "return") {
          for (const item of order.cart) {
            await productCollection.updateOne(
              { _id: item.productId, "sizes.size": item.selectedSize },
              { $inc: { "sizes.$.stock": item.quantity } }
            );
          }
        }
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    ///

    app.put("/api/orders/:orderId", async (req, res) => {
      const { orderId } = req.params;
      const updatedOrder = req.body;

      try {
        const order = await orderCollection.findByIdAndUpdate(
          orderId,
          updatedOrder,
          { new: true }
        );

        if (!order) {
          return res.status(404).json({ message: "Order not found." });
        }

        res.status(200).json(order);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    ///

    app.delete("/api/orders/:orderId", async (req, res) => {
      const { orderId } = req.params;

      try {
        const order = await orderCollection.findByIdAndDelete(orderId);

        if (!order) {
          return res.status(404).json({ message: "Order not found." });
        }

        // Update stock for each item in the order if needed
        order.cart.forEach(async (item) => {
          await productCollection.findByIdAndUpdate(item.productId, {
            $inc: { [`sizes.${item.selectedSize}.stock`]: item.quantity },
          });
        });

        res.status(200).json({ message: "Order deleted successfully." });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  } finally {
    // Do not close the connection as it would stop the server
    // await client.close();
  }
}

// Run the server and establish MongoDB connection
run().catch(console.dir);

// Root API route to check server status
app.get("/", (req, res) => {
  res.send("Bashboard Server running successfully");
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
