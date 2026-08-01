alter role authenticator set pgrst.db_timezone_enabled = 'false';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';;
