"""Exact CAS for the candidate-only legacy personal-space context function."""
import re

SIGNATURE='public.ensure_course_personal_space(text,uuid,text,text,text)'


def body(source):
    matches=re.findall(r'CREATE (?:OR REPLACE )?FUNCTION public\.ensure_course_personal_space\(\s*p_course_id text,\s*p_teaching_project_id uuid,.*?as \$\$(.*?)\$\$;',source,re.S|re.I)
    if len(matches)!=1:raise ValueError('KNOWN_PERSONAL_COMPAT_SOURCE_REQUIRED')
    return matches[0]


def body_pair(legacy,fixed):
    return body(legacy),body(fixed)


def patch_sql(legacy,fixed,*,apply=True):
    before,after=body_pair(legacy,fixed)
    quote=lambda value:"'"+value.replace("'","''")+"'"
    change='IF actual=original THEN EXECUTE replace(definition,original,patched);END IF;' if apply else ''
    return '\n'.join(['BEGIN;',"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';",
        "DO $guard$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED';END IF;END$guard$;",
        'DO $repair$DECLARE original text:='+quote(before)+';patched text:='+quote(after)+';actual text;definition text;BEGIN',
        "SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid='"+SIGNATURE+"'::regprocedure;",
        "IF actual IS NULL OR actual NOT IN(original,patched) THEN RAISE EXCEPTION 'WORKSPACE_PERSONAL_FUNCTION_CHANGED';END IF;",
        change,'END$repair$;','COMMIT;',''])
