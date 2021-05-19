const express = require('express');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const mongoose = require("mongoose");
const fetch = require("node-fetch");
var Twitter = require('twitter');

var client = new Twitter({
    consumer_key: '<twitter_consumer_key>',
    consumer_secret: '<twitter_consumer_secret>',
    access_token_key: '<twitter_access_token>',
    access_token_secret: '<twitter_token_secret>'
});

const app = express();

app.use(express.urlencoded({
    extended: true
}));
app.use(express.json()) // To parse the incoming requests with JSON payloads

mongoose.connect("mongodb+srv://<mongo_id>:<mongo_password>@cluster0.imull.mongodb.net/<db_name>?retryWrites=true&w=majority", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    useFindAndModify: false
});

const UserSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
    },
    token: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});
const User = mongoose.model("watson_user", UserSchema);

async function updateToken(body, token_) {
    const phoneNumber = body.WaId;
    const name = body.ProfileName;
    const token = token_;
    return await User.findOneAndUpdate({
        phoneNumber: phoneNumber
    }, {
        phoneNumber: phoneNumber,
        name: name,
        token: token
    }, {
        upsert: true
    });
}

async function getToken(body) {
    const phoneNumber = body.WaId;
    return await User.findOne({
        phoneNumber: phoneNumber
    }, function (err, user) {
        if (err) {
            console.error(err);
        } else if (user) {
            // console.log(user);
        } else {
            console.log("no user");
        }
    });
}

async function getTokenGuru(body) {
    const token = await getToken(body);
    let token_ = null;
    if (token) {
        token_ = token["token"];
        console.log("token avaiable " + token_);
    } else {
        console.log("token not avaiable, issuing new one!");
        const newToken = await issueToken();
        const result = await updateToken(body, newToken);
        token_ = newToken;
        if (result) {
            console.log("update success");
        } else {
            console.log("update failure");
        }
    }
    return token_;
}

async function issueToken() {
    let requestOptions = {
        method: 'POST',
        headers: {
            "Authorization": "Basic <auth_token>"
        },
        redirect: 'follow'
    };
    try {
        const response = await fetch("https://api.eu-gb.assistant.watson.cloud.ibm.com/instances/c1c5da3c-4e2d-4d3f-a5b5-f9d599ad7b95/v2/assistants/e9b260a7-5272-4d81-a2b7-f8d153a40a0e/sessions?version=2020-04-01", requestOptions);
        const result = await response.text();
        return JSON.parse(result)["session_id"];
    } catch (e) {
        console.error(e);
    }
}

async function askQuestion(question, body) {
    let token = await getTokenGuru(body);
    console.log(token, "{{{{{")
    let requestOptions = {
        method: 'POST',
        headers: {
            "Authorization": "Basic <auth_token>",
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "input": {
                "text": question
            }
        }),
        redirect: 'follow'
    };
    const response = await fetch("https://api.eu-gb.assistant.watson.cloud.ibm.com/instances/c1c5da3c-4e2d-4d3f-a5b5-f9d599ad7b95/v2/assistants/e9b260a7-5272-4d81-a2b7-f8d153a40a0e/sessions/" + token + "/message?version=2020-04-01", requestOptions)
    if (response.ok) {
        let result = JSON.parse(await response.text());
        let watsonOutput = result.output.generic[0].text;
        return watsonOutput;
    } else {
        let result2 = JSON.parse(await response.text());
        console.log(result2);
        console.log("token expired!");
        const newToken = await issueToken();
        const result = await updateToken(body, newToken);
        if (result) {
            console.log("update success");
            return askQuestion(question, body);
        } else {
            console.log("update failure");
        }
    }
}

async function getTweets(service, location) {
    let tweet_ = null;
    client.get('search/tweets', {
        q: `min_faves:20 ${service} ${location} verified`
    }, function (error, tweets, response) {
        tweet_ = tweets;
    });
    return tweet_;
}


app.post('/sms', async (req, res) => {
    const phoneNumber = req.body.WaId;
    const message = req.body.Body;

    const twiml = new MessagingResponse();

    const watsonOutput = await askQuestion(message, req.body);

    if (watsonOutput.startsWith("SEARCH")) {
        let location = watsonOutput.split(" ")[1];
        let service = watsonOutput.split(" ")[2];
        client.get('search/tweets', {
            q: `min_faves:20 ${service} ${location} verified`
        }, function (error, tweets, response) {
            if(!error){
                console.log(tweets.statuses[0].user);
                let allTweets = tweets.statuses;
                allTweets.sort((a, b) => {
                    return b.favorite_count - a.favorite_count;
                });
                let posts = [];
                console.log(allTweets[0].user);
                allTweets.forEach(e => {
                    posts.push(`🟢 ${e.text}\n*posted by ${e.user.name} @${e.user.screen_name} on ${e.created_at} Likes(${e.favorite_count})*`)
                });

                console.log(posts);

                twiml.message(posts.slice(0,5).join('\n\n'));
                res.writeHead(200, {
                    'Content-Type': 'text/xml'
                });
                res.end(twiml.toString());
            }
        });
    } else {
        twiml.message(watsonOutput);
        res.writeHead(200, {
            'Content-Type': 'text/xml'
        });
        res.end(twiml.toString());
    }
});

app.listen(8080, () => {
    console.log('Express server listening on port 1337');
});