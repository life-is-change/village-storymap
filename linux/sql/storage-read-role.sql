-- Candidate role only. Password is assigned on private stdin by guarded deploy.
DO $guard$
BEGIN
 IF current_database()<>'village_copy' THEN RAISE EXCEPTION 'WRONG_CANDIDATE_DATABASE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_storage_read_login') THEN RAISE EXCEPTION 'STORAGE_READ_ROLE_ALREADY_EXISTS'; END IF;
END $guard$;
CREATE ROLE village_storage_read_login LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
GRANT authenticated TO village_storage_read_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE village_copy TO village_storage_read_login;
ALTER ROLE village_storage_read_login IN DATABASE village_copy SET default_transaction_read_only=on;
