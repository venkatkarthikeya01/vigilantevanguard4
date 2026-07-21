-- ============================================================
-- VigilanteVanguard — Full Reference Seed Data (003)
-- Completes every table required by the ER diagram:
--   CasteMaster, BNS/IPC/POCSO/NDPS/SCST sections,
--   CrimeHeadActSection mappings, Courts, sample Units
--   (police stations), sample Employees, complete
--   Mar–Jun 2026 monthly stats, sample FIR + related rows.
-- Run AFTER 001_initial_schema.sql + 002_alter_schema.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. CASTE MASTER
-- ─────────────────────────────────────────────────────────────
INSERT INTO CasteMaster (caste_master_name) VALUES
('Scheduled Caste'),
('Scheduled Tribe'),
('Other Backward Class'),
('General / Unreserved'),
('Vokkaliga'),
('Lingayat'),
('Kuruba'),
('Brahmin'),
('Muslim OBC'),
('Christian'),
('Jain'),
('Other');

-- ─────────────────────────────────────────────────────────────
-- 2. REMAINING IPC SECTIONS (not in 002_seed_data.sql)
-- ─────────────────────────────────────────────────────────────
INSERT INTO Section (ActCode, SectionCode, SectionDescription, Active) VALUES
('IPC', '141',  'Unlawful assembly', 1),
('IPC', '143',  'Punishment for being member of unlawful assembly', 1),
('IPC', '147',  'Punishment for rioting', 1),
('IPC', '148',  'Rioting armed with deadly weapon', 1),
('IPC', '149',  'Every member of unlawful assembly guilty of offence committed in prosecution of common object', 1),
('IPC', '153A', 'Promoting enmity between different groups on grounds of religion, race, place of birth, residence, language etc.', 1),
('IPC', '279',  'Rash driving or riding on a public way', 1),
('IPC', '304B', 'Dowry death', 1),
('IPC', '306',  'Abetment of suicide', 1),
('IPC', '309',  'Attempt to commit suicide', 1),
('IPC', '324',  'Voluntarily causing hurt by dangerous weapons or means', 1),
('IPC', '325',  'Punishment for voluntarily causing grievous hurt', 1),
('IPC', '326',  'Voluntarily causing grievous hurt by dangerous weapons or means', 1),
('IPC', '336',  'Act endangering life or personal safety of others', 1),
('IPC', '341',  'Punishment for wrongful restraint', 1),
('IPC', '354A', 'Sexual harassment and punishment for sexual harassment', 1),
('IPC', '354D', 'Stalking', 1),
('IPC', '363',  'Punishment for kidnapping', 1),
('IPC', '364',  'Kidnapping or abducting in order to murder', 1),
('IPC', '366',  'Kidnapping, abducting or inducing woman to compel her marriage etc.', 1),
('IPC', '376A', 'Punishment for causing death or resulting in persistent vegetative state of victim', 1),
('IPC', '376AB','Punishment for rape on woman under twelve years of age', 1),
('IPC', '376D', 'Gang rape', 1),
('IPC', '384',  'Punishment for extortion', 1),
('IPC', '385',  'Putting person in fear of injury in order to commit extortion', 1),
('IPC', '400',  'Punishment for belonging to gang of dacoits', 1),
('IPC', '411',  'Dishonestly receiving stolen property', 1),
('IPC', '426',  'Punishment for mischief', 1),
('IPC', '436',  'Mischief by fire or explosive substance with intent to destroy house etc.', 1),
('IPC', '448',  'Punishment for house-trespass', 1),
('IPC', '457',  'Lurking house-trespass or house-breaking by night in order to commit offence', 1),
('IPC', '458',  'Lurking house-trespass or house-breaking by night after preparation for hurt, assault or wrongful restraint', 1),
('IPC', '489A', 'Counterfeiting currency notes or bank notes', 1),
('IPC', '504',  'Intentional insult with intent to provoke breach of the peace', 1),
('IPC', '506',  'Punishment for criminal intimidation', 1),
('IPC', '509',  'Word, gesture or act intended to insult the modesty of a woman', 1);

-- ─────────────────────────────────────────────────────────────
-- 3. FULL BNS SECTIONS
-- ─────────────────────────────────────────────────────────────
INSERT INTO Section (ActCode, SectionCode, SectionDescription, Active) VALUES
('BNS', '100',  'Culpable homicide', 1),
('BNS', '101',  'Culpable homicide not amounting to murder — punishment', 1),
('BNS', '102',  'Causing death by negligence', 1),
('BNS', '108',  'Abetment of suicide of child or person of unsound mind', 1),
('BNS', '110',  'Attempt to commit suicide to compel or restrain exercise of lawful power', 1),
('BNS', '115',  'Voluntarily causing hurt', 1),
('BNS', '117',  'Voluntarily causing grievous hurt by dangerous weapons or means', 1),
('BNS', '118',  'Voluntarily causing grievous hurt to extort property', 1),
('BNS', '124',  'Act endangering life or personal safety of others', 1),
('BNS', '130',  'Kidnapping', 1),
('BNS', '137',  'Kidnapping or abducting in order to murder', 1),
('BNS', '140',  'Kidnapping or abducting woman to compel her marriage', 1),
('BNS', '189',  'Unlawful assembly', 1),
('BNS', '191',  'Rioting', 1),
('BNS', '192',  'Rioting armed with deadly weapon', 1),
('BNS', '196',  'Promoting enmity between groups', 1),
('BNS', '281',  'Rash driving', 1),
('BNS', '303',  'Punishment for theft', 1),
('BNS', '304',  'Theft in dwelling house', 1),
('BNS', '309',  'Punishment for robbery', 1),
('BNS', '310',  'Punishment for dacoity', 1),
('BNS', '316',  'Punishment for extortion', 1),
('BNS', '351',  'Criminal intimidation', 1),
('BNS', '69',   'Sexual intercourse by employing deceitful means', 1),
('BNS', '70',   'Gang rape', 1),
('BNS', '74',   'Assault or use of criminal force to woman with intent to outrage her modesty', 1),
('BNS', '77',   'Stalking', 1);

-- ─────────────────────────────────────────────────────────────
-- 4. POCSO, NDPS, SC/ST, IT ACT KEY SECTIONS
-- ─────────────────────────────────────────────────────────────
INSERT INTO Section (ActCode, SectionCode, SectionDescription, Active) VALUES
('POCSO', '4',  'Punishment for penetrative sexual assault', 1),
('POCSO', '6',  'Punishment for aggravated penetrative sexual assault', 1),
('POCSO', '8',  'Punishment for sexual assault', 1),
('POCSO', '10', 'Punishment for aggravated sexual assault', 1),
('POCSO', '12', 'Punishment for sexual harassment', 1),
('POCSO', '14', 'Punishment for using child for pornographic purposes', 1),
('NDPS',  '8',  'Prohibition of certain operations', 1),
('NDPS',  '15', 'Punishment for contravention in relation to poppy straw', 1),
('NDPS',  '20', 'Punishment for contravention in relation to cannabis plant and cannabis', 1),
('NDPS',  '21', 'Punishment for contravention in relation to manufactured drugs and preparations', 1),
('NDPS',  '22', 'Punishment for contravention in relation to psychotropic substances', 1),
('NDPS',  '25', 'Punishment for allowing premises to be used for commission of an offence', 1),
('NDPS',  '29', 'Abetment and criminal conspiracy', 1),
('SCST',  '3',  'Offences atrocities', 1),
('SCST',  '3A', 'Offences of atrocities — additional provisions', 1),
('SCST',  '4',  'Punishment for neglect of duties', 1),
('IT',    '43', 'Penalty and compensation for damage to computer, computer system etc.', 1),
('IT',    '66', 'Computer related offences', 1),
('IT',    '66A','Punishment for sending offensive messages', 1),
('IT',    '66C','Punishment for identity theft', 1),
('IT',    '66D','Punishment for cheating by personation by using computer resource', 1),
('IT',    '67', 'Punishment for publishing or transmitting obscene material in electronic form', 1),
('IT',    '67B','Punishment for publishing or transmitting of material depicting children in sexually explicit act', 1);

-- ─────────────────────────────────────────────────────────────
-- 5. CRIME HEAD → ACT/SECTION MAPPINGS
--    CrimeHead IDs from seed 002:
--    1=Body, 2=Property, 3=Women, 4=Children, 5=SC/ST,
--    6=Cyber, 7=Economic, 8=SLL, 9=Traffic, 10=Public Order
-- ─────────────────────────────────────────────────────────────
INSERT INTO CrimeHeadActSection (CrimeHeadID, ActCode, SectionCode) VALUES
-- Crimes Against Body
(1, 'IPC', '302'), (1, 'BNS', '103'),   -- Murder
(1, 'IPC', '307'), (1, 'BNS', '109'),   -- Attempt to Murder
(1, 'IPC', '304'), (1, 'BNS', '101'),   -- Culpable Homicide
(1, 'IPC', '323'), (1, 'BNS', '115'),   -- Hurt
(1, 'IPC', '325'), (1, 'BNS', '117'),   -- Grievous Hurt
(1, 'IPC', '326A'),                     -- Acid Attack
(1, 'IPC', '304B'),(1, 'BNS', '80'),    -- Dowry Death
-- Crimes Against Property
(2, 'IPC', '395'), (2, 'BNS', '310'),   -- Dacoity
(2, 'IPC', '392'), (2, 'BNS', '309'),   -- Robbery
(2, 'IPC', '379'), (2, 'BNS', '303'),   -- Theft
(2, 'IPC', '380'), (2, 'BNS', '304'),   -- House Theft / Burglary
(2, 'IPC', '457'),                      -- House-breaking by night
(2, 'IPC', '384'), (2, 'BNS', '316'),   -- Extortion
(2, 'IPC', '420'), (2, 'IPC', '406'),   -- Cheating / CBT
(2, 'IPC', '465'),                      -- Forgery
-- Crimes Against Women
(3, 'IPC', '376'), (3, 'BNS', '64'),    -- Rape
(3, 'IPC', '354'), (3, 'BNS', '74'),    -- Molestation
(3, 'IPC', '498A'),(3, 'BNS', '85'),    -- Cruelty by husband
(3, 'IPC', '304B'),(3, 'BNS', '80'),    -- Dowry death (women)
(3, 'IPC', '366'), (3, 'BNS', '140'),   -- Kidnapping women
(3, 'BNS', '69'),                       -- Sexual intercourse by deceit
-- Crimes Against Children
(4, 'POCSO', '4'), (4, 'POCSO', '6'),
(4, 'POCSO', '8'), (4, 'POCSO', '10'),
(4, 'POCSO', '12'),(4, 'POCSO', '14'),
(4, 'IPC', '363'), (4, 'BNS', '130'),   -- Kidnapping of children
-- Crimes Against SC/ST
(5, 'SCST', '3'),  (5, 'SCST', '3A'),
-- Cyber Crimes
(6, 'IT', '66'),   (6, 'IT', '66C'),
(6, 'IT', '66D'),  (6, 'IT', '67'),
(6, 'IT', '67B'),
-- Economic Offences
(7, 'IPC', '406'), (7, 'IPC', '420'),
(7, 'IPC', '465'), (7, 'IPC', '489A'),
-- SLL / NDPS
(8, 'NDPS', '20'), (8, 'NDPS', '21'),
(8, 'NDPS', '22'), (8, 'NDPS', '8'),
-- Public Order
(10,'IPC', '147'), (10,'BNS', '191'),
(10,'IPC', '148'), (10,'BNS', '192'),
(10,'IPC', '153A'),(10,'BNS', '196');

-- ─────────────────────────────────────────────────────────────
-- 6. SAMPLE COURTS (one per major district)
-- ─────────────────────────────────────────────────────────────
-- StateID=1 (Karnataka). DistrictIDs from seed 002 order:
-- 1=Bagalkot,2=Ballari,3=Belagavi City,4=Belagavi District,
-- 5=Bengaluru City,6=Bengaluru District,7=Bengaluru South,
-- 8=Bidar,9=Chamarajanagar,10=Chickballapura,11=Chikkamagaluru,
-- 12=Chitradurga,13=Dakshina Kannada,14=Davanagere,15=Dharwad,
-- 16=Gadag,17=Hassan,18=Haveri,19=Hubballi Dharwad City,
-- 20=K.G.F,21=Kalaburagi,22=Kalaburagi City,23=Karnataka Railways,
-- 24=Kodagu,25=Kolar,26=Koppal,27=Mandya,28=Mangaluru City,
-- 29=Mysuru City,30=Mysuru District,31=Raichur,32=Shivamogga,
-- 33=Tumakuru,34=Udupi,35=Uttara Kannada,36=Vijayanagara,
-- 37=Vijayapur,38=Yadgir
INSERT INTO Court (CourtName, DistrictID, StateID, Active) VALUES
('Court of the Chief Metropolitan Magistrate, Bengaluru',         5,  1, 1),
('Sessions Court, Bengaluru City',                                5,  1, 1),
('Sessions Court, Mysuru',                                        29, 1, 1),
('Sessions Court, Belagavi',                                      4,  1, 1),
('Sessions Court, Kalaburagi',                                    21, 1, 1),
('Sessions Court, Davanagere',                                    14, 1, 1),
('Sessions Court, Shivamogga',                                    32, 1, 1),
('Sessions Court, Tumakuru',                                      33, 1, 1),
('Sessions Court, Mangaluru',                                     28, 1, 1),
('Sessions Court, Hubballi-Dharwad',                              19, 1, 1),
('Sessions Court, Bagalkot',                                      1,  1, 1),
('Sessions Court, Raichur',                                       31, 1, 1),
('Sessions Court, Ballari',                                       2,  1, 1),
('Sessions Court, Vijayapur',                                     37, 1, 1),
('Sessions Court, Hassan',                                        17, 1, 1),
('Sessions Court, Bidar',                                         8,  1, 1),
('Sessions Court, Chitradurga',                                   12, 1, 1),
('Sessions Court, Chikkamagaluru',                                11, 1, 1),
('Sessions Court, Kodagu',                                        24, 1, 1),
('Sessions Court, Udupi',                                         34, 1, 1),
('Sessions Court, Dakshina Kannada',                              13, 1, 1),
('Sessions Court, Uttara Kannada',                                35, 1, 1),
('Sessions Court, Kolar',                                         25, 1, 1),
('Sessions Court, Koppal',                                        26, 1, 1),
('Sessions Court, Mandya',                                        27, 1, 1),
('Sessions Court, Haveri',                                        18, 1, 1),
('Sessions Court, Gadag',                                         16, 1, 1),
('Sessions Court, Yadgir',                                        38, 1, 1);

-- ─────────────────────────────────────────────────────────────
-- 7. SAMPLE POLICE UNITS (stations in key districts)
--    UnitType IDs: 1=Police Station, 5=Commissionerate,
--    4=District SP Office, 7=State HQ
-- ─────────────────────────────────────────────────────────────
INSERT INTO Unit (UnitName, TypeID, ParentUnit, StateID, DistrictID, Latitude, Longitude, Active) VALUES
-- Bengaluru City Commissionerate (parent)
('Bengaluru City Police Commissionerate', 5, NULL, 1, 5,  12.9716, 77.5946, 1),
-- Bengaluru City stations
('Cubbon Park Police Station',           1, 1,    1, 5,  12.9792, 77.5913, 1),
('Shivajinagar Police Station',          1, 1,    1, 5,  12.9850, 77.6012, 1),
('Sadashivanagar Police Station',        1, 1,    1, 5,  13.0100, 77.5710, 1),
('Rajajinagar Police Station',           1, 1,    1, 5,  12.9920, 77.5530, 1),
('Jayanagar Police Station',             1, 1,    1, 5,  12.9258, 77.5830, 1),
('Koramangala Police Station',           1, 1,    1, 5,  12.9352, 77.6245, 1),
('Whitefield Police Station',            1, 1,    1, 5,  12.9698, 77.7500, 1),
('Electronic City Police Station',       1, 1,    1, 5,  12.8458, 77.6603, 1),
('Hebbal Police Station',                1, 1,    1, 5,  13.0358, 77.5970, 1),
-- Mysuru City
('Mysuru City Police Commissionerate',  5, NULL, 1, 29, 12.2958, 76.6394, 1),
('Devaraja Police Station',              1, 11,   1, 29, 12.3052, 76.6551, 1),
('Nazarbad Police Station',              1, 11,   1, 29, 12.2994, 76.6401, 1),
-- Belagavi
('Belagavi District SP Office',         4, NULL, 1, 4,  15.8497, 74.4977, 1),
('Belagavi City Police Station',         1, 14,   1, 3,  15.8697, 74.5177, 1),
-- Kalaburagi
('Kalaburagi District SP Office',       4, NULL, 1, 21, 17.2297, 76.7000, 1),
('Kalaburagi City Police Station',       1, 16,   1, 22, 17.3497, 76.8400, 1),
-- Mangaluru
('Mangaluru City Police Commissionerate',5,NULL, 1, 28, 12.9141, 74.8560, 1),
('Mangaluru East Police Station',        1, 18,   1, 28, 12.8800, 74.8700, 1),
-- Hubballi-Dharwad
('Hubballi-Dharwad City Police Commissionerate',5,NULL,1,19,15.3647,75.1240,1),
('Hubballi Central Police Station',      1, 20,   1, 19, 15.3600, 75.1350, 1),
-- Davanagere
('Davanagere District SP Office',       4, NULL, 1, 14, 14.4644, 75.9214, 1),
('Davanagere Town Police Station',       1, 22,   1, 14, 14.4700, 75.9300, 1),
-- Shivamogga
('Shivamogga District SP Office',       4, NULL, 1, 32, 13.9299, 75.5681, 1),
('Shivamogga Town Police Station',       1, 24,   1, 32, 13.9350, 75.5750, 1),
-- Karnataka State HQ
('Karnataka State Police HQ, Bengaluru',7, NULL, 1, 5,  12.9750, 77.5950, 1);

-- ─────────────────────────────────────────────────────────────
-- 8. SAMPLE EMPLOYEES
--    RankIDs: 8=PI, 9=PSI, 10=ASI, 11=HC, 12=PC
--    DesignationIDs: 1=IO, 2=SHO, 3=CI
-- ─────────────────────────────────────────────────────────────
INSERT INTO Employee (DistrictID, UnitID, RankID, DesignationID, KGID, FirstName, LastName, GenderID, AppointmentDate, Active) VALUES
(5,  2,  8,  2, 'KG2001001', 'Rajesh',     'Kumar',        1, '2010-06-15', 1),
(5,  2,  9,  1, 'KG2001002', 'Priya',      'Sharma',       2, '2015-03-22', 1),
(5,  3,  8,  2, 'KG2001003', 'Suresh',     'Babu',         1, '2008-11-10', 1),
(5,  4,  9,  1, 'KG2001004', 'Anitha',     'Reddy',        2, '2018-07-01', 1),
(5,  5,  8,  2, 'KG2001005', 'Venkatesh',  'Gowda',        1, '2012-04-20', 1),
(5,  6,  9,  1, 'KG2001006', 'Deepa',      'Naik',         2, '2019-09-05', 1),
(5,  7,  8,  2, 'KG2001007', 'Mahesh',     'Patil',        1, '2011-01-30', 1),
(5,  8,  9,  1, 'KG2001008', 'Kavitha',    'Shetty',       2, '2017-05-14', 1),
(29, 12, 8,  2, 'KG2901001', 'Nagesh',     'Rao',          1, '2009-08-25', 1),
(29, 12, 9,  1, 'KG2901002', 'Rekha',      'Bhat',         2, '2016-02-18', 1),
(4,  15, 8,  2, 'KG0401001', 'Shivakumar', 'Patil',        1, '2013-07-07', 1),
(4,  15, 9,  1, 'KG0401002', 'Savitha',    'Kulkarni',     2, '2020-03-01', 1),
(28, 19, 8,  2, 'KG2801001', 'Ramesh',     'D Souza',      1, '2007-12-12', 1),
(28, 19, 9,  1, 'KG2801002', 'Fatima',     'Begum',        2, '2021-06-15', 1),
(14, 23, 8,  2, 'KG1401001', 'Prakash',    'Hosamani',     1, '2014-10-20', 1),
(32, 25, 9,  1, 'KG3201001', 'Usha',       'Gowda',        2, '2018-08-08', 1);

-- ─────────────────────────────────────────────────────────────
-- 9. COMPLETE MONTHLY CRIME STATS (Mar–Jun 2026, all heads)
--    UnitID=1 used as state-level aggregate placeholder
--    (matches the Bengaluru City Commissionerate unit inserted above)
-- ─────────────────────────────────────────────────────────────

-- March 2026 (complete)
INSERT INTO MonthlyCrimeStat (Month, Year, UnitID, CrimeHeadCode, CrimeSubType, CaseCount, Source) VALUES
(3, 2026, 1, 'MURDER_TOTAL',       NULL,                104, 'KSP_PDF'),
(3, 2026, 1, 'MURDER_MOTIVE',      'Sudden Quarrel',     17, 'KSP_PDF'),
(3, 2026, 1, 'MURDER_MOTIVE',      'Other Causes',       21, 'KSP_PDF'),
(3, 2026, 1, 'MURDER_MOTIVE',      'Revenge/Enmity',      5, 'KSP_PDF'),
(3, 2026, 1, 'MURDER_MOTIVE',      'Civil Disputes',     11, 'KSP_PDF'),
(3, 2026, 1, 'ATTEMPT_MURDER',     NULL,                378, 'KSP_PDF'),
(3, 2026, 1, 'DACOITY',            NULL,                 18, 'KSP_PDF'),
(3, 2026, 1, 'ROBBERY',            NULL,                102, 'KSP_PDF'),
(3, 2026, 1, 'CHAIN_SNATCHING',    NULL,                 38, 'KSP_PDF'),
(3, 2026, 1, 'BURGLARY_NIGHT',     NULL,                267, 'KSP_PDF'),
(3, 2026, 1, 'BURGLARY_DAY',       NULL,                 78, 'KSP_PDF'),
(3, 2026, 1, 'THEFT',              NULL,               1713, 'KSP_PDF'),
(3, 2026, 1, 'THEFT_BREAKDOWN',    'Two Wheelers',       704, 'KSP_PDF'),
(3, 2026, 1, 'THEFT_BREAKDOWN',    'House Theft',        176, 'KSP_PDF'),
(3, 2026, 1, 'THEFT_BREAKDOWN',    'Sand Theft',         167, 'KSP_PDF'),
(3, 2026, 1, 'RIOTS',              NULL,                332, 'KSP_PDF'),
(3, 2026, 1, 'HURT',               NULL,               1784, 'KSP_PDF'),
(3, 2026, 1, 'SPL_LOCAL_LAWS',     NULL,               6726, 'KSP_PDF'),
(3, 2026, 1, 'RAPE',               NULL,                 48, 'KSP_PDF'),
(3, 2026, 1, 'DOWRY_DEATH',        NULL,                 18, 'KSP_PDF'),
(3, 2026, 1, 'POCSO',              NULL,                368, 'KSP_PDF'),
(3, 2026, 1, 'SCST_POA',           NULL,                225, 'KSP_PDF'),
(3, 2026, 1, 'CYBER_CRIME',        NULL,               1013, 'KSP_PDF'),
(3, 2026, 1, 'ECONOMIC_OFFENCES',  NULL,                494, 'KSP_PDF'),
(3, 2026, 1, 'MOTOR_VEHICLE_THEFT',NULL,                755, 'KSP_PDF'),
(3, 2026, 1, 'NDPS',               NULL,               1017, 'KSP_PDF'),
(3, 2026, 1, 'PAR_107',            NULL,               2702, 'KSP_PDF'),
(3, 2026, 1, 'PAR_109',            NULL,                273, 'KSP_PDF'),
(3, 2026, 1, 'PAR_110',            NULL,               2077, 'KSP_PDF'),

-- April 2026 (complete)
(4, 2026, 1, 'MURDER_TOTAL',       NULL,                 78, 'KSP_PDF'),
(4, 2026, 1, 'MURDER_MOTIVE',      'Sudden Quarrel',     25, 'KSP_PDF'),
(4, 2026, 1, 'MURDER_MOTIVE',      'Other Causes',       50, 'KSP_PDF'),
(4, 2026, 1, 'MURDER_MOTIVE',      'Revenge/Enmity',     10, 'KSP_PDF'),
(4, 2026, 1, 'MURDER_MOTIVE',      'Civil Disputes',     16, 'KSP_PDF'),
(4, 2026, 1, 'ATTEMPT_MURDER',     NULL,                319, 'KSP_PDF'),
(4, 2026, 1, 'DACOITY',            NULL,                  7, 'KSP_PDF'),
(4, 2026, 1, 'ROBBERY',            NULL,                 82, 'KSP_PDF'),
(4, 2026, 1, 'CHAIN_SNATCHING',    NULL,                 30, 'KSP_PDF'),
(4, 2026, 1, 'BURGLARY_NIGHT',     NULL,                323, 'KSP_PDF'),
(4, 2026, 1, 'BURGLARY_DAY',       NULL,                 74, 'KSP_PDF'),
(4, 2026, 1, 'THEFT',              NULL,               1694, 'KSP_PDF'),
(4, 2026, 1, 'THEFT_BREAKDOWN',    'Two Wheelers',       751, 'KSP_PDF'),
(4, 2026, 1, 'THEFT_BREAKDOWN',    'House Theft',        139, 'KSP_PDF'),
(4, 2026, 1, 'THEFT_BREAKDOWN',    'Sand Theft',         139, 'KSP_PDF'),
(4, 2026, 1, 'RIOTS',              NULL,                342, 'KSP_PDF'),
(4, 2026, 1, 'HURT',               NULL,               1756, 'KSP_PDF'),
(4, 2026, 1, 'SPL_LOCAL_LAWS',     NULL,               5395, 'KSP_PDF'),
(4, 2026, 1, 'RAPE',               NULL,                 56, 'KSP_PDF'),
(4, 2026, 1, 'DOWRY_DEATH',        NULL,                 15, 'KSP_PDF'),
(4, 2026, 1, 'POCSO',              NULL,                394, 'KSP_PDF'),
(4, 2026, 1, 'SCST_POA',           NULL,                237, 'KSP_PDF'),
(4, 2026, 1, 'CYBER_CRIME',        NULL,                928, 'KSP_PDF'),
(4, 2026, 1, 'ECONOMIC_OFFENCES',  NULL,                546, 'KSP_PDF'),
(4, 2026, 1, 'MOTOR_VEHICLE_THEFT',NULL,                804, 'KSP_PDF'),
(4, 2026, 1, 'NDPS',               NULL,                940, 'KSP_PDF'),
(4, 2026, 1, 'PAR_107',            NULL,               1760, 'KSP_PDF'),
(4, 2026, 1, 'PAR_109',            NULL,                162, 'KSP_PDF'),
(4, 2026, 1, 'PAR_110',            NULL,               1497, 'KSP_PDF'),

-- May 2026 (complete)
(5, 2026, 1, 'MURDER_TOTAL',       NULL,                 94, 'KSP_PDF'),
(5, 2026, 1, 'MURDER_MOTIVE',      'Sudden Quarrel',     33, 'KSP_PDF'),
(5, 2026, 1, 'MURDER_MOTIVE',      'Other Causes',       63, 'KSP_PDF'),
(5, 2026, 1, 'MURDER_MOTIVE',      'Revenge/Enmity',     18, 'KSP_PDF'),
(5, 2026, 1, 'MURDER_MOTIVE',      'Civil Disputes',     22, 'KSP_PDF'),
(5, 2026, 1, 'ATTEMPT_MURDER',     NULL,                394, 'KSP_PDF'),
(5, 2026, 1, 'DACOITY',            NULL,                 15, 'KSP_PDF'),
(5, 2026, 1, 'ROBBERY',            NULL,                101, 'KSP_PDF'),
(5, 2026, 1, 'CHAIN_SNATCHING',    NULL,                 36, 'KSP_PDF'),
(5, 2026, 1, 'BURGLARY_NIGHT',     NULL,                324, 'KSP_PDF'),
(5, 2026, 1, 'BURGLARY_DAY',       NULL,                 57, 'KSP_PDF'),
(5, 2026, 1, 'THEFT',              NULL,               1740, 'KSP_PDF'),
(5, 2026, 1, 'THEFT_BREAKDOWN',    'Two Wheelers',       716, 'KSP_PDF'),
(5, 2026, 1, 'THEFT_BREAKDOWN',    'House Theft',        170, 'KSP_PDF'),
(5, 2026, 1, 'THEFT_BREAKDOWN',    'Sand Theft',         186, 'KSP_PDF'),
(5, 2026, 1, 'RIOTS',              NULL,                383, 'KSP_PDF'),
(5, 2026, 1, 'HURT',               NULL,               1710, 'KSP_PDF'),
(5, 2026, 1, 'SPL_LOCAL_LAWS',     NULL,               5563, 'KSP_PDF'),
(5, 2026, 1, 'RAPE',               NULL,                 57, 'KSP_PDF'),
(5, 2026, 1, 'DOWRY_DEATH',        NULL,                 10, 'KSP_PDF'),
(5, 2026, 1, 'POCSO',              NULL,                406, 'KSP_PDF'),
(5, 2026, 1, 'SCST_POA',           NULL,                232, 'KSP_PDF'),
(5, 2026, 1, 'CYBER_CRIME',        NULL,                947, 'KSP_PDF'),
(5, 2026, 1, 'ECONOMIC_OFFENCES',  NULL,                542, 'KSP_PDF'),
(5, 2026, 1, 'MOTOR_VEHICLE_THEFT',NULL,                761, 'KSP_PDF'),
(5, 2026, 1, 'NDPS',               NULL,                813, 'KSP_PDF'),
(5, 2026, 1, 'PAR_107',            NULL,               3302, 'KSP_PDF'),
(5, 2026, 1, 'PAR_109',            NULL,                210, 'KSP_PDF'),
(5, 2026, 1, 'PAR_110',            NULL,               2233, 'KSP_PDF'),

-- June 2026 (complete)
(6, 2026, 1, 'MURDER_TOTAL',       NULL,                113, 'KSP_PDF'),
(6, 2026, 1, 'MURDER_MOTIVE',      'Sudden Quarrel',     46, 'KSP_PDF'),
(6, 2026, 1, 'MURDER_MOTIVE',      'Other Causes',       76, 'KSP_PDF'),
(6, 2026, 1, 'MURDER_MOTIVE',      'Revenge/Enmity',     25, 'KSP_PDF'),
(6, 2026, 1, 'MURDER_MOTIVE',      'Civil Disputes',     29, 'KSP_PDF'),
(6, 2026, 1, 'ATTEMPT_MURDER',     NULL,                359, 'KSP_PDF'),
(6, 2026, 1, 'DACOITY',            NULL,                 16, 'KSP_PDF'),
(6, 2026, 1, 'ROBBERY',            NULL,                 94, 'KSP_PDF'),
(6, 2026, 1, 'CHAIN_SNATCHING',    NULL,                 39, 'KSP_PDF'),
(6, 2026, 1, 'BURGLARY_NIGHT',     NULL,                266, 'KSP_PDF'),
(6, 2026, 1, 'BURGLARY_DAY',       NULL,                 69, 'KSP_PDF'),
(6, 2026, 1, 'THEFT',              NULL,               1589, 'KSP_PDF'),
(6, 2026, 1, 'THEFT_BREAKDOWN',    'Two Wheelers',       671, 'KSP_PDF'),
(6, 2026, 1, 'THEFT_BREAKDOWN',    'House Theft',        156, 'KSP_PDF'),
(6, 2026, 1, 'THEFT_BREAKDOWN',    'Sand Theft',         137, 'KSP_PDF'),
(6, 2026, 1, 'RIOTS',              NULL,                378, 'KSP_PDF'),
(6, 2026, 1, 'HURT',               NULL,               1565, 'KSP_PDF'),
(6, 2026, 1, 'SPL_LOCAL_LAWS',     NULL,               5996, 'KSP_PDF'),
(6, 2026, 1, 'RAPE',               NULL,                 63, 'KSP_PDF'),
(6, 2026, 1, 'DOWRY_DEATH',        NULL,                  8, 'KSP_PDF'),
(6, 2026, 1, 'POCSO',              NULL,                374, 'KSP_PDF'),
(6, 2026, 1, 'SCST_POA',           NULL,                240, 'KSP_PDF'),
(6, 2026, 1, 'CYBER_CRIME',        NULL,                921, 'KSP_PDF'),
(6, 2026, 1, 'ECONOMIC_OFFENCES',  NULL,                543, 'KSP_PDF'),
(6, 2026, 1, 'MOTOR_VEHICLE_THEFT',NULL,                706, 'KSP_PDF'),
(6, 2026, 1, 'NDPS',               NULL,               1232, 'KSP_PDF'),
(6, 2026, 1, 'PAR_107',            NULL,               2501, 'KSP_PDF'),
(6, 2026, 1, 'PAR_109',            NULL,                278, 'KSP_PDF'),
(6, 2026, 1, 'PAR_110',            NULL,               2358, 'KSP_PDF');

-- ─────────────────────────────────────────────────────────────
-- 10. SAMPLE FIR DATA (3 realistic cases across districts)
-- ─────────────────────────────────────────────────────────────

-- CaseCategoryID 1 = FIR
-- GravityOffenceID 1 = Heinous, 2 = Non-Heinous
-- CaseStatusID 1 = Under Investigation, 2 = Charge Sheeted

INSERT INTO CaseMaster (
    CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID,
    CaseCategoryID, GravityOffenceID, CrimeMajorHeadID, CrimeMinorHeadID,
    CaseStatusID, CourtID,
    IncidentFromDate, IncidentToDate, InfoReceivedPSDate,
    Latitude, Longitude, BriefFacts
) VALUES
-- Case 1: Murder — Koramangala, Bengaluru City
(
    '104430007202600001',
    '202600001',
    '2026-01-08',
    1, 7, 1, 1, 1, 1, 1, 2,
    '2026-01-07 22:30:00', '2026-01-07 23:00:00', '2026-01-08 00:15:00',
    12.9352, 77.6245,
    'Victim Ramaiah (42, male) found dead with stab injuries near Koramangala 4th Block. Altercation reportedly over a land dispute. Accused A1 identified as Srinivas (neighbour). Weapon recovered.'
),
-- Case 2: Robbery (Chain Snatching) — Shivajinagar, Bengaluru City
(
    '104430003202600002',
    '202600002',
    '2026-01-15',
    2, 3, 1, 2, 2, 10, 1, 1,
    '2026-01-15 09:15:00', '2026-01-15 09:20:00', '2026-01-15 09:45:00',
    12.9850, 77.6012,
    'Complainant Sunita Devi (35, female) reported chain snatching on M.G. Road junction. Accused on motorcycle snatched gold chain worth Rs 45,000. CCTV footage obtained. Two accused absconding.'
),
-- Case 3: POCSO — Mysuru City
(
    '129000012202600001',
    '202600001',
    '2026-02-03',
    9, 12, 1, 1, 4, 26, 1, 3,
    '2026-01-28 18:00:00', '2026-01-28 20:00:00', '2026-02-03 10:00:00',
    12.3052, 76.6551,
    'Minor girl (13 yrs) subjected to sexual assault by known person (neighbour). Complaint filed by mother. Child referred to CHILDLINE and One-Stop Centre. Medical examination conducted. Accused A1 arrested.'
);

-- Complainants
INSERT INTO ComplainantDetails (CaseMasterID, ComplainantName, AgeYear, OccupationID, ReligionID, CasteID, GenderID) VALUES
(1, 'Kavitha Ramaiah',    38, 8,  1, 4, 2),  -- Wife of victim, Case 1
(2, 'Sunita Devi',        35, 3,  1, 3, 2),  -- Victim herself, Case 2
(3, 'Meenakshi Nagaraj',  38, 8,  1, 1, 2);  -- Mother, Case 3

-- Victims
INSERT INTO Victim (CaseMasterID, VictimName, AgeYear, GenderID, VictimPolice, Injury) VALUES
(1, 'Ramaiah Gowda',  42, 1, 0, 'Fatal stab wounds to chest and abdomen'),
(2, 'Sunita Devi',    35, 2, 0, 'Minor abrasion on neck from chain snatch'),
(3, 'Minor Girl',     13, 2, 0, 'Sexual assault — medical report on record');

-- Accused
INSERT INTO Accused (CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, IsKnown, PriorRecordFlag) VALUES
(1, 'Srinivas Kumar',     38, 1, 'A1', 1, 0),
(1, 'Unknown Accomplice', NULL,1, 'A2', 0, 0),
(2, 'Vijay (alias Chotu)',27, 1, 'A1', 0, 1),
(2, 'Raju',               24, 1, 'A2', 0, 1),
(3, 'Nagaraj S',          45, 1, 'A1', 1, 0);

-- Act-Section Associations
INSERT INTO ActSectionAssociation (CaseMasterID, ActID, SectionID, ActOrderID, SectionOrderID) VALUES
(1, 'IPC', '302', 1, 1),   -- Case 1: Murder
(1, 'BNS', '103', 1, 2),
(2, 'IPC', '392', 1, 1),   -- Case 2: Robbery
(2, 'BNS', '309', 1, 2),
(3, 'POCSO', '6', 1, 1),   -- Case 3: POCSO aggravated
(3, 'IPC', '376', 1, 2);

-- Arrest / Surrender (Case 1 and Case 3 accused arrested)
INSERT INTO ArrestSurrender (
    CaseMasterID, ArrestSurrenderTypeID, ArrestSurrenderDate,
    ArrestSurrenderStateId, ArrestSurrenderDistrictId,
    PoliceStationID, IOID, CourtID, AccusedMasterID, IsAccused
) VALUES
(1, 1, '2026-01-10', 1, 5, 7, 1, 2, 1, 1),   -- Case 1 A1 arrested
(3, 1, '2026-02-04', 1, 29, 12, 9, 3, 5, 1); -- Case 3 A1 arrested

-- Junction: inv_arrestsurrenderaccused
INSERT INTO inv_arrestsurrenderaccused (ArrestSurrenderID, AccusedMasterID) VALUES
(1, 1),
(2, 5);

-- Occurrence Time Records
INSERT INTO Inv_OccuranceTime (CaseMasterID, DayOfWeek, TimeOfDay, OccurrenceHour) VALUES
(1, 'Wednesday', 'Night',     22),
(2, 'Thursday',  'Morning',    9),
(3, 'Wednesday', 'Evening',   18);

-- Chargesheet (Case 3 charge-sheeted quickly)
INSERT INTO ChargesheetDetails (CaseMasterID, csdate, cstype, PolicePersonID) VALUES
(3, '2026-02-25 11:00:00', 'A', 9);

-- ─────────────────────────────────────────────────────────────
-- 11. KNOWN CRIME HOTSPOTS (seeded from Jan 2026 analysis)
-- ─────────────────────────────────────────────────────────────
INSERT INTO CrimeHotspot (DistrictID, UnitID, Latitude, Longitude, RadiusMeters, CrimeHead, IntensityScore, PredictedDate) VALUES
(5,  7, 12.9352, 77.6245, 800,  'Robbery/Theft',     87.5, '2026-02-01'),
(5,  8, 12.9698, 77.7500, 1000, 'Cyber Crime',        92.0, '2026-02-01'),
(5,  6, 12.9258, 77.5830, 600,  'Hurt/Assault',       78.3, '2026-02-01'),
(29,12, 12.3052, 76.6551, 700,  'Theft',              74.1, '2026-02-01'),
(4, 15, 15.8697, 74.5177, 1200, 'Riots',              69.8, '2026-02-01'),
(32,25, 13.9350, 75.5750, 900,  'NDPS',               83.2, '2026-02-01'),
(19,21, 15.3600, 75.1350, 1000, 'NDPS',               79.5, '2026-02-01'),
(14,23, 14.4700, 75.9300, 800,  'Theft',              71.0, '2026-02-01'),
(2,  2, 15.1394, 76.9214, 700,  'SC/ST Atrocities',   68.5, '2026-02-01'),
(31, 1, 16.2120, 77.3439, 600,  'SC/ST Atrocities',   65.0, '2026-02-01');
