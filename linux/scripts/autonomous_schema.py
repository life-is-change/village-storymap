"""Audited schema order, atomic install receipts and bounded local Auth ownership."""
import hashlib
import ipaddress
from pathlib import Path
import re
from autonomous_bundle import load_script

UNIFIED=('identity','catalog','survey','planning','events','files','scene','tasks')
LOCAL=('local-auth','local-auth-recovery','local-tasks','local-task-files','local-cloud')


def schema_bundle(root):
    root=Path(root);builder=load_script('build-unified-release');result={}
    for name in UNIFIED:
        result[name+'.sql']=builder.scene_sql(root) if name=='scene' else (root/'linux/sql/unified'/(name+'.sql')).read_text(encoding='utf-8')
    for name in LOCAL:result[name+'.sql']=(root/'linux/sql'/(name+'.sql')).read_text(encoding='utf-8')
    return result


def step_hash(sql):return hashlib.sha256(sql.replace('\r\n','\n').encode()).hexdigest()


CONTROL_SQL="""BEGIN;
DO $$BEGIN IF current_database()<>'village_unified_candidate' THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED';END IF;END$$;
CREATE SCHEMA autonomous_control;
REVOKE ALL ON SCHEMA autonomous_control FROM PUBLIC,anon,authenticated;
CREATE TABLE autonomous_control.installed_steps(name text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),installed_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON autonomous_control.installed_steps FROM PUBLIC,anon,authenticated;
COMMIT;
"""


def transactional_step(name,sql):
    if name not in {item+'.sql' for item in (*UNIFIED,*LOCAL)}:raise ValueError('KNOWN_SCHEMA_STEP_REQUIRED')
    body=re.sub(r'^\s*(?:BEGIN|COMMIT);\s*$','',sql.replace('\r\n','\n'),flags=re.M)
    return "BEGIN;\nDO $$BEGIN IF current_database()<>'village_unified_candidate' THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED';END IF;END$$;\n"+body+"\nINSERT INTO autonomous_control.installed_steps(name,sha256) VALUES('"+name+"','"+step_hash(sql)+"');\nCOMMIT;\n"


def hba(subnet,*,migration):
    network=ipaddress.ip_network(subnet,strict=True)
    if network.version!=4 or not network.is_private or network.prefixlen<16:raise ValueError('PRIVATE_DOCKER_SUBNET_REQUIRED')
    roles=['village_unified_login','village_auth_runtime',*(['village_auth_migrator'] if migration else [])]
    return 'local all all trust\n'+''.join('host village_unified_candidate '+role+' '+str(network)+' scram-sha-256\n' for role in roles)+'host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'


def auth_owner_sql(migrator_password,runtime_password):
    if any(not re.fullmatch('[a-zA-Z0-9_-]{48}',p or '') for p in (migrator_password,runtime_password)) or migrator_password==runtime_password:
        raise ValueError('DISTINCT_GENERATED_AUTH_PASSWORDS_REQUIRED')
    # Caller must first audit every non-internal Auth trigger and verify the
    # restored archive, before making either a migration or business schema.
    return """BEGIN;
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('village_auth_migrator','village_auth_runtime')) THEN RAISE EXCEPTION 'FRESH_AUTH_OWNER_REQUIRED';END IF;END$$;
CREATE ROLE village_auth_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD '"""+migrator_password+"""';
CREATE ROLE village_auth_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD '"""+runtime_password+"""';
GRANT CONNECT ON DATABASE village_unified_candidate TO village_auth_migrator,village_auth_runtime;
REVOKE CREATE ON SCHEMA public FROM village_auth_migrator,village_auth_runtime;
ALTER SCHEMA auth OWNER TO village_auth_migrator;
ALTER ROLE village_auth_migrator IN DATABASE village_unified_candidate SET search_path=auth;
ALTER ROLE village_auth_runtime IN DATABASE village_unified_candidate SET search_path=auth;
DO $$DECLARE item record;command text;BEGIN
 FOR item IN SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='auth' AND c.relkind IN ('r','p','S','v','m','f')
 ORDER BY CASE WHEN c.relkind='S' THEN 1 ELSE 0 END,c.oid LOOP
  command:=CASE item.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END;
  EXECUTE format('ALTER %s auth.%I OWNER TO village_auth_migrator',command,item.relname);
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='auth' AND p.prokind IN ('f','p') LOOP
  EXECUTE format('ALTER ROUTINE %s OWNER TO village_auth_migrator',item.signature);
 END LOOP;
END$$;
COMMIT;
"""
