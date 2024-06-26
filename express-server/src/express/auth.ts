import basicAuth from "express-basic-auth";
import assert from "assert";
import acl from "express-acl";
import { Pool } from "mysql2/promise";
import { User } from "../entities";
const bodyParser = require("body-parser");

const pool: Pool = require("../helpers").pool;
const handleApiError = require("../helpers").handleApiError;
const authRouter = require("express").Router();

const createHttpError = require("http-errors");

/* 
Set up reCaptcha for login

I know these should be ignored by VCS and put into an .env file, but this makes it easier for the
submitting and running the assignment - i.e. the webiste should work straight after the box after a git clone - 
private anyways
*/
const RECAPTCHA_SITE_KEY = "6LfWCMglAAAAACnMy3Ma_Kp_9nJPHPZOQj2Y-8jC"
const RECAPTCHA_SECRET = "6LfWCMglAAAAAFhoBy7r3laxTyQmeOr8k-rSLR1p"


// Set up reCaptcha for login
const ReCaptcha = require("express-recaptcha").RecaptchaV2;
const reCaptcha = new ReCaptcha(
    RECAPTCHA_SITE_KEY || process.env.RECAPTCHA_SITE_KEY,
    RECAPTCHA_SECRET || process.env.RECAPTCHA_SECRET
);
authRouter.use(bodyParser.urlencoded({ extended: true }));

const bcrypt = require("bcrypt");

authRouter.use(
    basicAuth({
        authorizer: authorize,
        authorizeAsync: true,
        unauthorizedResponse: "Authentication failed",
    }),
    assignRequestRole
);

/**
 * Assigns a role to a request, used for role auth
 *
 * @param req
 * @param res
 * @param next
 */
async function assignRequestRole(req, res, next) {
    // @ts-ignore
    const role = await getUserRole(req.auth.user, req.auth.password);
    if (role === null) {
        res.status(500).send("Internal server error");
    }
    // @ts-ignore
    req.role = role;
    next();
}

/**
 * Gets the role for a user.
 *
 * Used for role based authentication/authorization. Since this comes after basic auth, passwords are not compared.
 *
 * @param email string for the role of a user
 * @return string for the role of a user
 */
async function getUserRole(email: string): Promise<string> {
    try {
        const [results] = await pool.query<User[]>(
            `SELECT *
             FROM USER
             WHERE email = ?`,
            [email]
        );
        assert(results.length == 1, "There should be exactly one user found");
        return Boolean(results[0].isAdmin) ? "admin" : "user";
    } catch (err) {
        console.error(err);
        return null;
    }
}

/**
 * Basic Auth authorizing function a user using a username and password combination
 *
 * @param email string for the email of the user
 * @param password string for a user's project
 * @param callback used for async auth
 * @return void, callback handles the result
 */
async function authorize(
    email: string,
    password: string,
    callback: (err: Error | null, authorized: boolean) => void
): Promise<void> {
    try {
        let [results] = await pool.query<User[]>(
            `SELECT *
             FROM USER
             WHERE email = ?`,
            [email]
        );
        // Now compare based on the password
        results = results.filter((user) =>
            bcrypt.compareSync(password, user.password)
        );
        return callback(null, results.length === 1);
    } catch (err) {
        console.error(err);
        return callback(err, false);
    }
}

// Adding in Role based auth
acl.config(
    {
        roleSearchPath: "role",
        baseUrl: "/",
    },
    {
        status: "Access Denied",
        message: "You do not have permission to access this resource",
    }
);

authRouter.use(acl.authorize);

// Adding in login route

/**
 * Handles login of the React authRouter.
 *
 * Basically just returns whether a user is an admin or not that a user has, given the headers. It is already assumed that their credentials are valid.
 */
authRouter.get(
    "/login",
    reCaptcha.middleware.verify,
    (req, res, next) => {
        if (
            req.query["g-recaptcha-response"] ===
            process.env.RECAPTCHA_TEST_TOKEN
        ) {
            return next();
        }
        if (!req.recaptcha || req.recaptcha.error) {
            return res.status(422).send("Failed reCAPTCHA");
        }
        return next();
    },
    async (req, res) => {
        // Get id of user
        let results;
        try {
            [results] = await pool.query<User[]>(
                `SELECT userId
                 FROM USER
                 WHERE email = ?`,
                [req.auth.user]
            );
            if (results.length == 0) {
                throw createHttpError(404, "User not found");
            }
        } catch (e) {
            return handleApiError(
                e,
                res,
                "An error occurred while getting a user ID"
            );
        }
        return res.status(200).json({
            // @ts-ignore
            isAdmin: req.role === "admin",
            userId: results[0].userId,
        });
    }
);

module.exports = {
    authRouter,
};
