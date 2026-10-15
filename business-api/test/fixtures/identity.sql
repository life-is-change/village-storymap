CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid primary key,student_id text,display_name text,role text,gender text,class_name text,grade text);
CREATE FUNCTION public.current_profile_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT role FROM profiles WHERE id=auth.uid() $$;
CREATE FUNCTION public.current_profile_student_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT student_id||'::'||display_name FROM profiles WHERE id=auth.uid() $$;
CREATE TABLE public.courses(id text primary key,title text,village_id text);
CREATE TABLE public.group_memberships(group_id text,student_key text);
CREATE TABLE public.planning_spaces(id text primary key,title text,course_id text,group_id text,space_type text,teaching_project_id uuid,village_id uuid);
CREATE TABLE public.course_personal_spaces(id uuid primary key,title text,owner_id uuid,course_id text,village_id uuid,space_type text);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_personal_spaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated USING(id=auth.uid() OR current_profile_role() IN ('teacher','admin'));
CREATE POLICY courses_read ON courses FOR SELECT TO authenticated USING(true);
CREATE POLICY memberships_read ON group_memberships FOR SELECT TO authenticated USING(true);
CREATE POLICY personal_read ON course_personal_spaces FOR SELECT TO authenticated USING(owner_id=auth.uid());
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO profiles VALUES
 ('10000000-0000-4000-8000-000000000001','a','A','student','','',''),
 ('20000000-0000-4000-8000-000000000002','b','B','student','','',''),
 ('30000000-0000-4000-8000-000000000003','t','T','teacher','','',''),
 ('40000000-0000-4000-8000-000000000004','m','M','admin','','','');
INSERT INTO courses VALUES('course','Course','village');
INSERT INTO group_memberships VALUES('group-a','a::A');
INSERT INTO planning_spaces(id,title,group_id,space_type) VALUES('A','A','group-a','course_group'),('B','B','group-b','course_group');
INSERT INTO course_personal_spaces(id,title,owner_id) VALUES
 ('a0000000-0000-4000-8000-000000000001','A','10000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000002','B','20000000-0000-4000-8000-000000000002');
