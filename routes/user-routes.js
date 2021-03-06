// ALL THE USER-RELATED ROUTES ARE HANDLED BY THIS FILE

const
  app = require('express').Router(),
  db = require('../config/db'),
  dir = process.cwd(),
  mail = require('../config/Mail'),
  User = require('../config/User'),
  fs = require('fs'),
  { promisify } = require('util'),
  { success } = require('handy-log'),
  mw = require('../config/middlewares'),
  { uniqBy } = require('lodash')

// USER LOGIN GET ROUTE
app.get('/login', mw.NotLoggedIn, (req, res) => {
  let options = {
    title: 'Login To Continue',
    users: req.cookies.users
      ? JSON.parse(req.cookies.users).slice(0, 15)
      : []
  }
  res.render('login', { options })
})

// USER SIGNUP GET ROUTE
app.get('/signup', mw.NotLoggedIn, (req, res) => {
  let options = { title: 'Signup For Free' }
  res.render('signup', { options })
})

// CHECKS IF USERNAME EXISTS WHEN REGISTERING
app.post('/user/username-checker', async (req, res) => {
  let [{ count }] = await db.query(
    'SELECT COUNT(username) AS count FROM users WHERE username=?',
    [ req.body.value ]
  )
  res.json(count)
})

// REGISTERS A USER
app.post('/user/signup', async (req, res) => {
  let {
    body: { username, firstname, surname, email, password },
    session
  } = req

  db.c_validator('username', req)
  db.c_validator('firstname', req)
  db.c_validator('surname', req)

  req.checkBody('email', 'Email is empty!!').notEmpty()
  req.checkBody('email', 'Invalid empty!!').isEmail()
  req.checkBody('password', 'Password field is empty').notEmpty()

  let errors = await req.getValidationResult()
  if (!errors.isEmpty()){
    let array = []
    errors.array().forEach(e => array.push(e.msg))
    res.json({ mssg: array })
  } else {

    let
      [{ usernameCount }] = await db.query(
        'SELECT COUNT(username) as usernameCount from users WHERE username=?',
        [ username ]
      ),
      [{ emailCount }] = await db.query('SELECT COUNT(email) as emailCount from users WHERE email=?', [ email ])

    if (usernameCount == 1) {
      res.json({ mssg: 'Username already exists!!' })
    } else if (emailCount == 1) {
      res.json({ mssg: 'Email already exists!!' })
    } else {

      let
        newUser = {
          username,
          firstname,
          surname,
          email,
          password,
          joined: new Date().getTime(),
          email_verified: 'no',
          isOnline: 'yes'
        },
        { insertId, affectedRows } = await User.create_user(newUser),
        mkdir = promisify(fs.mkdir)

      if (affectedRows == 1){

        await mkdir(`${dir}/public/users/${insertId}`)
        fs
          .createReadStream(`${dir}/public/images/spacecraft.jpg`)
          .pipe(fs.createWriteStream(`${dir}/public/users/${insertId}/avatar.jpg`))

        let
          url = `http://localhost:${process.env.PORT}/deep/most/topmost/activate/${insertId}`,
          options = {
            to: email,
            subject: 'Activate your Instagram account',
            html: `<span>Hello ${username}, You received this message because you created an account on Instagram.<span><br><span>Click on button below to activate your account and explore.</span><br><br><a href='${url}' style='border: 1px solid #1b9be9; font-weight: 600; color: #fff; border-radius: 3px; cursor: pointer; outline: none; background: #1b9be9; padding: 4px 15px; display: inline-block; text-decoration: none;'>Activate</a>`
          }

        session.id = insertId
        session.username = username
        session.email_verified = 'no'

        try {
          let m = await mail(options)
          success(m)

          res.json({
            mssg: `Hello, ${username}!!`,
            success: true
          })
        } catch (error) {
          res.json({
            mssg: `Hello, ${username}. Mail could not be sent!!`,
            success: true
          })
        }

      } else {
        res.json({ mssg: 'An error occured creating your account!!' })
      }

    }

  }

})

// LOGS THE USER IN
app.post('/user/login', async (req, res) => {
  let {
    body: { username: rusername, password: rpassword },
    session
  } = req

  req.checkBody('username', 'Username is empty!!').notEmpty()
  req.checkBody('password', 'Password field is empty!!').notEmpty()

  let errors = await req.getValidationResult()
  if (!errors.isEmpty()) {
    let array = []
    errors.array().forEach(e => array.push(e.msg))
    res.json({ mssg: array })
  } else {

    let [{
      userCount, id, password, email_verified
    }] = await db.query(
      'SELECT COUNT(id) as userCount, id, password, email_verified from users WHERE username=? LIMIT 1',
      [ rusername ]
    )

    if (userCount == 0){
      res.json({ mssg: 'User not found!!' })
    } else {
      let same = User.comparePassword(rpassword, password)
      if (!same) {
        res.json({ mssg: 'Wrong password!!' })
      } else {

        session.id = id
        session.username = rusername
        session.email_verified = email_verified
        session.isadmin = false

        await db.query('UPDATE users SET isOnline=? WHERE id=?', [ 'yes', id ])

        res.json({
          mssg: `Welcome ${rusername}!!`,
          success: true
        })

      }
    }

  }
})

// LOGS USER OUT
app.get('/logout', mw.LoggedIn, async (req, res) => {
  let
    { id, username } = req.session,
    user = { id, username },
    oldUsers = req.cookies.users ? JSON.parse(req.cookies.users) : [],
    users = []

  oldUsers.map(o => users.push(o) )
  let final = uniqBy([ user, ...users ], 'id')
  res.cookie('users', `${JSON.stringify(final)}`)

  let u = {
    isOnline: 'no',
    lastOnline: new Date().getTime()
  }
  await db.query('UPDATE users SET ? WHERE id=?', [ u, id ])

  let url = req.session.reset() ? '/login' : '/'
  res.redirect(url)
})

// FORGOT PASSWORD
app.get('/forgot-password', mw.NotLoggedIn, (req, res) => {
  let options = { title: 'Forgot password' }
  res.render('forgotPassword', { options })
})

// RETRIVE PASSWORD
app.post('/user/password-retrieve', async (req, res) => {
  let
    { email } = req.body,
    [{ emailExists, id, username, email_verified }]  = await db.query(
      'SELECT COUNT(email) AS emailExists, id, username, email_verified FROM users WHERE email=?',
      [ email ]
    )

  req.checkBody('email', 'Email is empty!!').notEmpty()
  req.checkBody('email', 'Invalid email!!').isEmail()

  let errors = await req.getValidationResult()
  if (!errors.isEmpty()) {
    let array = []
    errors.array().forEach(e => array.push(e.msg))
    res.json({ mssg: array })
  } else {

    if (emailExists == 0) {
      res.json({ mssg: 'No such user exists!!' })
    } else {

      req.session.id = id
      req.session.username = username
      req.session.email_verified = email_verified

      res.json({
        mssg: 'Successful',
        success: true
      })

    }

  }

})

// USER IS REDIRECTED TO THIS ROUTE AFTER REGISTERATION
app.get('/registered', mw.LoggedIn, async (req, res) => {
  let
    { id } = req.session,
    [{ email_verified }] = await db.query('SELECT email_verified FROM users WHERE id=? LIMIT 1', [ id ]),
    options = {
      title: 'Registered',
      mssg: 'Email has been sent. Check your inbox and click on the provided link!!'
    }

  email_verified == 'yes'
    ? res.redirect('/')
    : res.render('registered', { options })

})

// USER EMAIL VERIFICATION
app.get('/deep/most/topmost/activate/:id', async (req, res) => {
  let
    { params: { id }, session } = req,
    { changedRows } = await db.query('UPDATE users SET email_verified=? WHERE id=?', ['yes', id]),
    mssg

  session.email_verified = 'yes'
  mssg = changedRows == 0 ? 'alr' : 'yes'

  res.redirect(`/email-verification/${mssg}`)

})

// USER PASSWORD CHANGE
app.post('/user/change-password', async (req, res) => {
  let
    { old, new_, new_a } = req.body,
    { id } = req.session,
    user_pass = await User.getWhat('password', id)

  req.checkBody('old', 'Old password is empty!!').notEmpty()
  req.checkBody('new_', 'New password field is empty!!').notEmpty()
  req.checkBody('new_a', 'New password field is empty!!').notEmpty()

  let errors = await req.getValidationResult()
  if (!errors.isEmpty()) {
    let array = []
    errors.array().forEach(e => array.push(e.msg))
    res.json({ mssg: array })
  } else {
    let same = await User.comparePassword(old, user_pass)

    if (!same) {
      res.json({ mssg: 'Incorrect password!!' })
    } else if (new_ != new_a) {
      res.json({ mssg: 'New passwords don\'t match' })
    } else {
      let done = await User.change_password({ id, password: new_ })

      if (done) {
        res.json({
          mssg: 'Password changed!!',
          success: true
        })
      } else {
        res.json({ mssg: 'Error changing the password!!' })
      }

    }

  }

})

// USER DEACTIVATE ACCOUNT
app.post('/user/deactivate-account', async (req, res) => {
  let
    { id } = req.session,
    userPassword = await User.getWhat('password', id),
    { password } = req.body,
    samePassword = await User.comparePassword(password, userPassword)

  req.checkBody('password', 'Password is empty!!').notEmpty()

  let errors = await req.getValidationResult()
  if (!errors.isEmpty()) {
    let array = []
    errors.array().forEach(e => array.push(e.msg))
    res.json({ mssg: array })
  } else if (!samePassword) {
    res.json({ mssg: 'Wrong password!!' })
  } else {

    await User.deactivate(id, req, res)

    res.json({
      mssg: 'Deactivated your account successfully!!',
      success: true
    })

  }

})

// REMOVES USER [ACTION DONE BY THE ADMIN]
app.post('/user/remove-user', async (req, res) => {
  let
    { user } = req.body,
    username = await User.getWhat('username', user)

  await User.deactivate(user, req, res)
  res.json({
    mssg: `Removed ${username}`,
    success: true
  })
})

// QUICK LOGIN = USER ONLY HAVE TO PROVIDE PASSWORD, USERNAME IS STORED IN COOKIE
// REMOVE QUICK LOGIN
app.post('/api/remove-quick-login', (req, res) => {
  let
    users = JSON.parse(req.cookies.users),
    filtered = users.filter(u => u.id != req.body.id )

  res.cookie('users', `${JSON.stringify(filtered)}`)
  res.json('Hello, World!!')
})

// CLEAR ALL QUICK LOGINS
app.post('/api/clear-all-quick-logins', (req, res) => {
  res.clearCookie('users')
  res.json('Hello, World!!')
})

// CHECKS IF USER IS THE ADMIN
app.post('/api/check-is-admin', async (req, res) => {
  let
    { password } = req.body,
    { ADMIN_PASSWORD } = process.env

  if (password != ADMIN_PASSWORD) {
    res.json({ mssg: 'Wrong password!!' })
  } else {
    req.session.isadmin = true
    res.json({
      mssg: 'Hello admin!!',
      success: true
    })
  }

})

// ADMIN LOGOUT
app.post('/api/admin-logout', async (req, res) => {
  req.session.isadmin = false
  res.json('Hello, World!!')
})

module.exports = app
