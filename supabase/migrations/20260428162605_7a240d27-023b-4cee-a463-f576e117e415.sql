-- Reset password to 'Test1234!' for the four seeded test accounts.
-- bcrypt hash of 'Test1234!' generated with cost 10.
UPDATE auth.users
SET encrypted_password = crypt('Test1234!', gen_salt('bf', 10)),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email IN ('user1@test.com','user2@test.com','publisher1@test.com','editor1@test.com');