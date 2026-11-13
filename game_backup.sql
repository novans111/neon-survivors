BEGIN TRANSACTION;
CREATE TABLE runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                weapon TEXT NOT NULL DEFAULT 'wand',
                score INTEGER NOT NULL DEFAULT 0,
                survival_time INTEGER NOT NULL DEFAULT 0,
                kills INTEGER NOT NULL DEFAULT 0,
                level_reached INTEGER NOT NULL DEFAULT 1,
                gold_earned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
INSERT INTO "runs" VALUES(1,1,'nill_kiggers','lightning',1325,45,82,5,15,'2026-11-10 14:11:34');
INSERT INTO "runs" VALUES(2,1,'nill_kiggers','blades',693,37,35,3,4,'2026-11-10 14:15:32');
INSERT INTO "runs" VALUES(3,4,'Gapchuk','wand',2782,156,158,7,36,'2026-11-10 14:19:19');
INSERT INTO "runs" VALUES(4,3,'goida','wand',3215,167,186,8,60,'2026-11-10 14:19:19');
INSERT INTO "runs" VALUES(5,4,'Gapchuk','wand',2975,145,176,8,45,'2026-11-10 14:22:23');
INSERT INTO "runs" VALUES(6,3,'goida','wand',7567,213,524,15,256,'2026-11-10 14:23:53');
INSERT INTO "runs" VALUES(7,3,'goida','wand',100,6,2,1,0,'2026-11-10 14:24:03');
INSERT INTO "runs" VALUES(8,3,'goida','wand',75,3,1,1,0,'2026-11-10 14:24:30');
INSERT INTO "runs" VALUES(9,4,'Gapchuk','wand',2216,160,106,6,28,'2026-11-10 14:25:42');
INSERT INTO "runs" VALUES(10,8,'pepe','blades',2667,93,167,9,41,'2026-11-13 07:44:10');
INSERT INTO "runs" VALUES(11,9,'CyberSamurai','slash',6240,198,435,12,120,'2026-11-12 18:30:00');
INSERT INTO "runs" VALUES(12,10,'NeonViper','blades',5120,184,390,11,95,'2026-11-12 19:15:00');
INSERT INTO "runs" VALUES(13,11,'VoidWalker','lightning',4300,172,280,9,70,'2026-11-12 20:00:00');
INSERT INTO "runs" VALUES(14,12,'Stalker77','wand',3540,165,240,8,60,'2026-11-13 01:20:00');
INSERT INTO "runs" VALUES(15,13,'MatrixRunner','wand',2180,115,145,7,38,'2026-11-13 03:45:00');
INSERT INTO "runs" VALUES(16,14,'ZeroCool','lightning',1820,92,120,6,28,'2026-11-13 05:10:00');
INSERT INTO "runs" VALUES(17,15,'Shadow_Ninja','slash',1490,74,95,5,22,'2026-11-13 06:00:00');
INSERT INTO "runs" VALUES(18,2,'пупа','wand',820,42,48,4,12,'2026-11-13 06:40:00');
CREATE TABLE sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
INSERT INTO "sessions" VALUES('b6d5f692768ffae3fddf24734312ef275abb38b3abb4f9ae',1,'2026-11-10 14:10:34');
INSERT INTO "sessions" VALUES('33a86f42e52689e8cf9e66ab002f5ef423a6f04930d23897',2,'2026-11-10 14:12:07');
INSERT INTO "sessions" VALUES('d21367574506bf4c22d84cc8d31416952eee9d5140441c47',1,'2026-11-10 14:14:36');
INSERT INTO "sessions" VALUES('4fe049e7427a6d556c88640b4c1a153817c6175b5de87a22',3,'2026-11-10 14:16:04');
INSERT INTO "sessions" VALUES('6de388845f9d0b9c7341ad0ee031887e8640f57de5b7cbeb',5,'2026-11-10 14:20:56');
INSERT INTO "sessions" VALUES('4c0a4bbb772121b161ad92421e38c5b05e7338094cac25a2',6,'2026-11-10 14:24:45');
INSERT INTO "sessions" VALUES('b6f5fb1ab7be19639b160e3bc8fbafdf788781f878f20bc4',4,'2026-11-10 14:25:50');
INSERT INTO "sessions" VALUES('8fe4e041f6e2a1cf14e483ba177bc536d08c1d39af70e61f',7,'2026-11-10 14:25:56');
INSERT INTO "sessions" VALUES('a54c8298c61e328554c0430c9b8a009c195ebf11b3e1edaa',6,'2026-11-10 14:28:26');
INSERT INTO "sessions" VALUES('9619dabdf936003e17abf9e76b921fb005de925209eb77a0',8,'2026-11-13 07:41:16');
CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                gold INTEGER NOT NULL DEFAULT 0,
                upgrades_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
INSERT INTO "users" VALUES(1,'nill_kiggers','29e5e94f5502361c2fc5ff2b9c9bc306$7242716667d8a7d1c68aee55ef992b96602906b50feb16bcb69b6a9c64629c92',19,'{"max_hp": 0, "move_speed": 0, "damage": 0, "magnet": 0, "greed": 0}','2026-11-10 14:10:34');
INSERT INTO "users" VALUES(2,'пупа','fb8211d7064088b74047dcd757c20d5b$be9e2b475bfa19e172593c37e8cdcc92853644786d4d27f0fb8bc1f87a982a5f',0,'{"max_hp": 0, "move_speed": 0, "damage": 0, "magnet": 0, "greed": 0}','2026-11-10 14:12:07');
INSERT INTO "users" VALUES(3,'goida','32efbf70b29cbb44e66f87e9b7fc4465$e2590dac4a0cccc361fbd7cc777f175e7324cca846ec76ed811246956bd3f1be',4,'{"max_hp": 0, "move_speed": 0, "damage": 3, "magnet": 2, "greed": 1}','2026-11-10 14:16:04');
INSERT INTO "users" VALUES(4,'Gapchuk','662be45cf8d127e5b214d5e993345d13$a1af8990d96391c7ad62bee1c4215ac17073d0063f36d280527feeafca3e4462',34,'{"max_hp": 0, "move_speed": 1, "damage": 1, "magnet": 0, "greed": 0}','2026-11-10 14:16:16');
INSERT INTO "users" VALUES(5,'Писюн','11ca624f46aecea9f15948263e2408ed$1d822bb3aa095ff2f8fb49c4390968efa634abf0f26502fab79a1dd4af86603c',0,'{"max_hp": 0, "move_speed": 0, "damage": 0, "magnet": 0, "greed": 0}','2026-11-10 14:20:56');
INSERT INTO "users" VALUES(6,'VanLin','9d0fa895a51e62d040d07c9f66e2d8f8$ba60383ef9675840a87a49446efaaf4cfb7a1304f16b7ea6515d5809c80e7557',0,'{"max_hp": 0, "move_speed": 0, "damage": 0, "magnet": 0, "greed": 0}','2026-11-10 14:24:45');
INSERT INTO "users" VALUES(7,'qqq','e4849a6c22f1bb20ff7b1d0e28f35469$2dfcb57f4319cfb7dc7141db92ecf56980e69168a667dc563af424adef2c98a1',0,'{"max_hp": 0, "move_speed": 0, "damage": 0, "magnet": 0, "greed": 0}','2026-11-10 14:25:56');
INSERT INTO "users" VALUES(8,'pepe','2ba2f279fed21b5929eb84be67d96a13$024f0eb27d10a7aca58ca11861dc6bad99706e9730fc9eeb9da6dff161844df1',1,'{"max_hp": 0, "move_speed": 0, "damage": 1, "magnet": 0, "greed": 0}','2026-11-13 07:41:16');
INSERT INTO "users" VALUES(9,'CyberSamurai','seed_salt_123$5795114ce1a01e372023904cd66b8bf025364c92ba7ce80ae4eebe7eec0e962e',240,'{"damage": 1, "max_hp": 1}','2026-11-12 18:30:00');
INSERT INTO "users" VALUES(10,'NeonViper','seed_salt_123$3cebc39fb03ffd8d4314dde16fd95f9f4e7ad3b91b1aa0b4d2105dd1fc04fcb4',190,'{"damage": 1, "max_hp": 1}','2026-11-12 19:15:00');
INSERT INTO "users" VALUES(11,'VoidWalker','seed_salt_123$42ced187eb63eaeaa9c3a154c189b85611339cdf4a3125f39f5ad47cf04a7c19',140,'{"damage": 1, "max_hp": 1}','2026-11-12 20:00:00');
INSERT INTO "users" VALUES(12,'Stalker77','seed_salt_123$30967f78894e5ba62e059c48f3a4401680308c0d7d448c191888f9d4048ed366',120,'{"damage": 1, "max_hp": 1}','2026-11-13 01:20:00');
INSERT INTO "users" VALUES(13,'MatrixRunner','seed_salt_123$1930711523bb93e3dc93a714033743d66432d751c0fd3cc2a22c67e6036479dd',76,'{"damage": 1, "max_hp": 1}','2026-11-13 03:45:00');
INSERT INTO "users" VALUES(14,'ZeroCool','seed_salt_123$3161601383fe70d137936abd38bfb2dee1be73cb7af8b852ab8586ef3c2d0256',56,'{"damage": 1, "max_hp": 1}','2026-11-13 05:10:00');
INSERT INTO "users" VALUES(15,'Shadow_Ninja','seed_salt_123$ad488f7b095b465fe6d69c325095be391905c5d259404699df90583080b9ebf5',44,'{"damage": 1, "max_hp": 1}','2026-11-13 06:00:00');
CREATE INDEX idx_runs_score ON runs(score DESC, survival_time DESC);
CREATE INDEX idx_runs_user ON runs(user_id, created_at DESC);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('users',15);
INSERT INTO "sqlite_sequence" VALUES('runs',18);
COMMIT;
