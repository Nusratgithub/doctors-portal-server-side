const express = require('express')
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_KEY);

const app = express();
const cors = require('cors')
const port = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.send('platform running')
})

app.use(cors());
app.use(express.json());

console.log(process.env.DB_USER);
console.log(process.env.DB_PASSWORD);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.9y7gcsu.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbidden access' })
    }
    req.decoded = decoded;
    next();
  })
}

// async await
async function run() {
  try {
    const appointmentCollection = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const userCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db('doctorsPortal').collection('doctors');
    const paymentsCollection = client.db('doctorsPortal').collection('payments');

    // NOTE: make sure you use verifyAdmin after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // appointment collection

    // Use Aggregate to query multiple collection and then merge data
    app.get('/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentCollection.find(query).toArray();

      // get the bookings of the provided date
      const bookingQuery = { appointmentDate: date }
      const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();

      // code carefully :D
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots;
      })
      res.send(options);
    });

    // app.get('/v2/appointmentOptions', async (req, res) => {
    //   const date = req.query.date;
    //   const options = await appointmentCollection.aggregate([
    //     {
    //       $lookup: {
    //         from: 'bookings',
    //         localField: 'name',
    //         foreignField: 'treatment',
    //         pipeline: [
    //           {
    //             $match: {
    //               $expr: {
    //                 $eq: ['$appointmentDate', date]
    //               }
    //             }
    //           }
    //         ],
    //         as: 'booked'
    //       }
    //     },
    //     {
    //       $project: {
    //         name: 1,
    //         price: 1,
    //         slots: 1,
    //         booked: {
    //           $map: {
    //             input: '$booked',
    //             as: 'book',
    //             in: '$$book.slot'
    //           }
    //         }
    //       }
    //     },
    //     {
    //       $project: {
    //         name: 1,
    //         price: 1,
    //         slots: {
    //           $setDifference: ['$slots', '$booked']
    //         }
    //       }
    //     }
    //   ]).toArray();
    //   res.send(options);
    // })

    app.get('/appointmentSpecialty', async (req, res) => {
      const query = {}
      const result = await appointmentCollection.find(query).project({ name: 1 }).toArray();
      res.send(result);
    })

    /***
     * API Naming Convention 
     * app.get('/bookings')
     * app.get('/bookings/:id')
     * app.post('/bookings')
     * app.patch('/bookings/:id')
     * app.delete('/bookings/:id')
    */

    // bookings collection

    app.get('/bookings', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    })

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })
      }

      const result = await bookingCollection.insertOne(booking);
      // send email about appointment confirmation 
      // sendBookingEmail(booking)
      res.send(result);
    });

    // CREATE JWT TOKEN

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      console.log(user);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
        return res.send({ accessToken: token });
      }
      res.send({ accessToken: 'token' })
    });

    // users collection

    app.get('/users', async (req, res) => {
      const query = {};
      const users = await userCollection.find(query).toArray();
      res.send(users);
    });

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      console.log(email)
      const query = { email }
      const user = await userCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user);
      // TODO: make sure you do not enter duplicate user email
      // only insert users if the user doesn't exist in the database
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    });

    // payment collection

    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        "payment_method_types": [
          "card"
        ]
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updatedResult = await bookingCollection.updateOne(filter, updatedDoc)
      res.send(result);
    })


    // doctors collection

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })


  }
  finally {

  }
}

run().catch(err => {
  console.log(err)
})

app.listen(port, () => {
  console.log(`simple node server running on port ${port}`);
}) 