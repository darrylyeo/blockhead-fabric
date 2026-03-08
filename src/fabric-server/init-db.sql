-- Let map user create database (install:svc runs MSF_Map.sql which creates map_db)
GRANT ALL PRIVILEGES ON *.* TO 'map'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
