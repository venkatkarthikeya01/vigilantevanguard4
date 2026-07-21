-- ============================================================
-- VigilanteVanguard — Catalyst Data Store Schema
-- Based on official Karnataka Police FIR System ER Diagram
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- LOOKUP / REFERENCE TABLES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS State (
    StateID       INT PRIMARY KEY AUTO_INCREMENT,
    StateName     VARCHAR(100) NOT NULL,
    NationalityID INT,
    Active        TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS District (
    DistrictID   INT PRIMARY KEY AUTO_INCREMENT,
    DistrictName VARCHAR(150) NOT NULL,
    StateID      INT NOT NULL,
    Active       TINYINT(1) DEFAULT 1,
    FOREIGN KEY (StateID) REFERENCES State(StateID)
);

CREATE TABLE IF NOT EXISTS UnitType (
    UnitTypeID   INT PRIMARY KEY AUTO_INCREMENT,
    UnitTypeName VARCHAR(100) NOT NULL,
    CityDistState VARCHAR(20),   -- 'City' | 'District' | 'State'
    Hierarchy    INT,
    Active       TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Unit (
    UnitID       INT PRIMARY KEY AUTO_INCREMENT,
    UnitName     VARCHAR(200) NOT NULL,
    TypeID       INT NOT NULL,
    ParentUnit   INT,            -- Self-reference for hierarchy
    NationalityID INT,
    StateID      INT NOT NULL,
    DistrictID   INT NOT NULL,
    Latitude     DECIMAL(10,7),
    Longitude    DECIMAL(10,7),
    Active       TINYINT(1) DEFAULT 1,
    FOREIGN KEY (TypeID)     REFERENCES UnitType(UnitTypeID),
    FOREIGN KEY (StateID)    REFERENCES State(StateID),
    FOREIGN KEY (DistrictID) REFERENCES District(DistrictID)
);

CREATE TABLE IF NOT EXISTS Rank (
    RankID    INT PRIMARY KEY AUTO_INCREMENT,
    RankName  VARCHAR(100) NOT NULL,
    Hierarchy INT,
    Active    TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Designation (
    DesignationID   INT PRIMARY KEY AUTO_INCREMENT,
    DesignationName VARCHAR(150) NOT NULL,
    Active          TINYINT(1) DEFAULT 1,
    SortOrder       INT
);

CREATE TABLE IF NOT EXISTS Employee (
    EmployeeID          INT PRIMARY KEY AUTO_INCREMENT,
    DistrictID          INT NOT NULL,
    UnitID              INT NOT NULL,
    RankID              INT NOT NULL,
    DesignationID       INT NOT NULL,
    KGID                VARCHAR(20) UNIQUE,    -- Karnataka Government ID
    FirstName           VARCHAR(100) NOT NULL,
    LastName            VARCHAR(100),
    EmployeeDOB         DATE,
    GenderID            TINYINT,               -- 1=Male 2=Female 3=Transgender
    BloodGroupID        TINYINT,
    PhysicallyChallenged TINYINT(1) DEFAULT 0,
    AppointmentDate     DATE,
    Active              TINYINT(1) DEFAULT 1,
    FOREIGN KEY (DistrictID)    REFERENCES District(DistrictID),
    FOREIGN KEY (UnitID)        REFERENCES Unit(UnitID),
    FOREIGN KEY (RankID)        REFERENCES Rank(RankID),
    FOREIGN KEY (DesignationID) REFERENCES Designation(DesignationID)
);

CREATE TABLE IF NOT EXISTS Court (
    CourtID    INT PRIMARY KEY AUTO_INCREMENT,
    CourtName  VARCHAR(200) NOT NULL,
    DistrictID INT NOT NULL,
    StateID    INT NOT NULL,
    Active     TINYINT(1) DEFAULT 1,
    FOREIGN KEY (DistrictID) REFERENCES District(DistrictID),
    FOREIGN KEY (StateID)    REFERENCES State(StateID)
);

CREATE TABLE IF NOT EXISTS GravityOffence (
    GravityOffenceID INT PRIMARY KEY AUTO_INCREMENT,
    LookupValue      VARCHAR(100) NOT NULL  -- e.g. 'Heinous', 'Non-Heinous'
);

CREATE TABLE IF NOT EXISTS CaseCategory (
    CaseCategoryID INT PRIMARY KEY AUTO_INCREMENT,
    LookupValue    VARCHAR(50) NOT NULL,    -- FIR | UDR | PAR | Zero FIR
    CategoryCode   CHAR(1) NOT NULL         -- 1=FIR, 3=UDR, 4=PAR, 8=Zero FIR
);

CREATE TABLE IF NOT EXISTS CaseStatusMaster (
    CaseStatusID   INT PRIMARY KEY AUTO_INCREMENT,
    CaseStatusName VARCHAR(100) NOT NULL   -- Under Investigation | Charge Sheeted | Closed | FR
);

CREATE TABLE IF NOT EXISTS OccupationMaster (
    OccupationID   INT PRIMARY KEY AUTO_INCREMENT,
    OccupationName VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS ReligionMaster (
    ReligionID   INT PRIMARY KEY AUTO_INCREMENT,
    ReligionName VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS CasteMaster (
    caste_master_id   INT PRIMARY KEY AUTO_INCREMENT,
    caste_master_name VARCHAR(100) NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- ACT / SECTION (IPC, BNS, NDPS, POCSO, SC-ST POA etc.)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS Act (
    ActCode         VARCHAR(20) PRIMARY KEY,  -- e.g. 'IPC', 'BNS', 'POCSO', 'NDPS'
    ActDescription  VARCHAR(500) NOT NULL,
    ShortName       VARCHAR(50),
    Active          TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Section (
    ActCode            VARCHAR(20) NOT NULL,
    SectionCode        VARCHAR(20) NOT NULL,
    SectionDescription VARCHAR(500),
    Active             TINYINT(1) DEFAULT 1,
    PRIMARY KEY (ActCode, SectionCode),
    FOREIGN KEY (ActCode) REFERENCES Act(ActCode)
);

-- ─────────────────────────────────────────────────────────────
-- CRIME CLASSIFICATION HIERARCHY
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CrimeHead (
    CrimeHeadID    INT PRIMARY KEY AUTO_INCREMENT,
    CrimeGroupName VARCHAR(200) NOT NULL,   -- e.g. 'Crimes Against Body'
    Active         TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS CrimeSubHead (
    CrimeSubHeadID INT PRIMARY KEY AUTO_INCREMENT,
    CrimeHeadID    INT NOT NULL,
    CrimeHeadName  VARCHAR(200) NOT NULL,  -- e.g. 'Murder', 'Robbery'
    SeqID          INT,
    FOREIGN KEY (CrimeHeadID) REFERENCES CrimeHead(CrimeHeadID)
);

CREATE TABLE IF NOT EXISTS CrimeHeadActSection (
    CrimeHeadID INT NOT NULL,
    ActCode     VARCHAR(20) NOT NULL,
    SectionCode VARCHAR(20) NOT NULL,
    FOREIGN KEY (CrimeHeadID) REFERENCES CrimeHead(CrimeHeadID),
    FOREIGN KEY (ActCode)     REFERENCES Act(ActCode)
);

-- ─────────────────────────────────────────────────────────────
-- CORE FIR / CASE TABLES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CaseMaster (
    CaseMasterID          INT PRIMARY KEY AUTO_INCREMENT,
    -- Format: CategoryCode(1) + DistrictID(4) + UnitID(4) + Year(4) + Serial(5)
    -- e.g. FIR = 104430006202600001
    CrimeNo               VARCHAR(30) UNIQUE NOT NULL,
    CaseNo                VARCHAR(20),
    CrimeRegisteredDate   DATE NOT NULL,
    PolicePersonID        INT NOT NULL,      -- Registering officer
    PoliceStationID       INT NOT NULL,
    CaseCategoryID        INT NOT NULL,
    GravityOffenceID      INT,
    CrimeMajorHeadID      INT,
    CrimeMinorHeadID      INT,
    CaseStatusID          INT,
    CourtID               INT,
    IncidentFromDate      DATETIME,
    IncidentToDate        DATETIME,
    InfoReceivedPSDate    DATETIME,
    Latitude              DECIMAL(10,7),
    Longitude             DECIMAL(10,7),
    BriefFacts            TEXT,
    CreatedAt             DATETIME DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt             DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (PolicePersonID)   REFERENCES Employee(EmployeeID),
    FOREIGN KEY (PoliceStationID)  REFERENCES Unit(UnitID),
    FOREIGN KEY (CaseCategoryID)   REFERENCES CaseCategory(CaseCategoryID),
    FOREIGN KEY (GravityOffenceID) REFERENCES GravityOffence(GravityOffenceID),
    FOREIGN KEY (CrimeMajorHeadID) REFERENCES CrimeHead(CrimeHeadID),
    FOREIGN KEY (CrimeMinorHeadID) REFERENCES CrimeSubHead(CrimeSubHeadID),
    FOREIGN KEY (CaseStatusID)     REFERENCES CaseStatusMaster(CaseStatusID),
    FOREIGN KEY (CourtID)          REFERENCES Court(CourtID)
);

CREATE TABLE IF NOT EXISTS ActSectionAssociation (
    CaseMasterID  INT NOT NULL,
    ActID         VARCHAR(20) NOT NULL,
    SectionID     VARCHAR(20) NOT NULL,
    ActOrderID    INT,
    SectionOrderID INT,
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster(CaseMasterID),
    FOREIGN KEY (ActID)        REFERENCES Act(ActCode)
);

CREATE TABLE IF NOT EXISTS ComplainantDetails (
    ComplainantID  INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID   INT NOT NULL,
    ComplainantName VARCHAR(200) NOT NULL,
    AgeYear        INT,
    OccupationID   INT,
    ReligionID     INT,
    CasteID        INT,
    GenderID       TINYINT,
    PhoneNumber    VARCHAR(15),
    Address        TEXT,
    FOREIGN KEY (CaseMasterID)  REFERENCES CaseMaster(CaseMasterID),
    FOREIGN KEY (OccupationID)  REFERENCES OccupationMaster(OccupationID),
    FOREIGN KEY (ReligionID)    REFERENCES ReligionMaster(ReligionID),
    FOREIGN KEY (CasteID)       REFERENCES CasteMaster(caste_master_id)
);

CREATE TABLE IF NOT EXISTS Victim (
    VictimMasterID INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID   INT NOT NULL,
    VictimName     VARCHAR(200) NOT NULL,
    AgeYear        INT,
    GenderID       TINYINT,               -- M/F/T
    VictimPolice   TINYINT(1) DEFAULT 0,  -- 1 if victim is police personnel
    Injury         VARCHAR(100),
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster(CaseMasterID)
);

CREATE TABLE IF NOT EXISTS Accused (
    AccusedMasterID INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID    INT NOT NULL,
    AccusedName     VARCHAR(200),          -- Can be unknown initially
    AgeYear         INT,
    GenderID        TINYINT,
    PersonID        VARCHAR(10),           -- A1, A2, A3...
    IsKnown         TINYINT(1) DEFAULT 1,
    Nationality     VARCHAR(50),
    Address         TEXT,
    PriorRecordFlag TINYINT(1) DEFAULT 0,
    RiskScore       DECIMAL(5,2),          -- AutoML-computed 0–100
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster(CaseMasterID)
);

CREATE TABLE IF NOT EXISTS ArrestSurrender (
    ArrestSurrenderID     INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID          INT NOT NULL,
    ArrestSurrenderTypeID INT,             -- 1=Arrest 2=Surrender
    ArrestSurrenderDate   DATE,
    ArrestSurrenderStateId INT,
    ArrestSurrenderDistrictId INT,
    PoliceStationID       INT,
    IOID                  INT,             -- Investigating Officer
    CourtID               INT,
    AccusedMasterID       INT,
    IsAccused             TINYINT(1) DEFAULT 1,
    IsComplainantAccused  TINYINT(1) DEFAULT 0,
    FOREIGN KEY (CaseMasterID)            REFERENCES CaseMaster(CaseMasterID),
    FOREIGN KEY (ArrestSurrenderDistrictId) REFERENCES District(DistrictID),
    FOREIGN KEY (PoliceStationID)         REFERENCES Unit(UnitID),
    FOREIGN KEY (IOID)                    REFERENCES Employee(EmployeeID),
    FOREIGN KEY (CourtID)                 REFERENCES Court(CourtID),
    FOREIGN KEY (AccusedMasterID)         REFERENCES Accused(AccusedMasterID)
);

CREATE TABLE IF NOT EXISTS ChargesheetDetails (
    CSID           INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID   INT NOT NULL,
    csdate         DATETIME,
    cstype         CHAR(1),    -- A=Chargesheet, B=False Case, C=Undetected
    PolicePersonID INT,
    FOREIGN KEY (CaseMasterID)   REFERENCES CaseMaster(CaseMasterID),
    FOREIGN KEY (PolicePersonID) REFERENCES Employee(EmployeeID)
);

CREATE TABLE IF NOT EXISTS Inv_OccuranceTime (
    CaseMasterID    INT PRIMARY KEY,
    DayOfWeek       VARCHAR(10),
    TimeOfDay       VARCHAR(20),   -- Morning/Afternoon/Evening/Night
    OccurrenceHour  INT,           -- 0–23
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster(CaseMasterID)
);

-- ─────────────────────────────────────────────────────────────
-- CRIME STATISTICS (Monthly Aggregates from CCTNS)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS MonthlyCrimeStat (
    StatID         INT PRIMARY KEY AUTO_INCREMENT,
    Month          INT NOT NULL,            -- 1–12
    Year           INT NOT NULL,
    UnitID         INT NOT NULL,            -- District/Unit
    CrimeHeadCode  VARCHAR(50) NOT NULL,    -- MURDER, DACOITY, THEFT, etc.
    CrimeSubType   VARCHAR(100),
    CaseCount      INT DEFAULT 0,
    Source         VARCHAR(50) DEFAULT 'CCTNS',
    ImportedAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UnitID) REFERENCES Unit(UnitID)
);

-- ─────────────────────────────────────────────────────────────
-- AI / INTELLIGENCE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS InvestigationNote (
    NoteID       INT PRIMARY KEY AUTO_INCREMENT,
    CaseMasterID INT NOT NULL,
    AuthorID     INT NOT NULL,
    NoteText     TEXT NOT NULL,
    IsAIGenerated TINYINT(1) DEFAULT 0,
    CreatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster(CaseMasterID),
    FOREIGN KEY (AuthorID)     REFERENCES Employee(EmployeeID)
);

CREATE TABLE IF NOT EXISTS CrimeHotspot (
    HotspotID    INT PRIMARY KEY AUTO_INCREMENT,
    DistrictID   INT NOT NULL,
    UnitID       INT,
    Latitude     DECIMAL(10,7) NOT NULL,
    Longitude    DECIMAL(10,7) NOT NULL,
    RadiusMeters INT DEFAULT 500,
    CrimeHead    VARCHAR(100),
    IntensityScore DECIMAL(5,2),
    PredictedDate DATE,
    ComputedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (DistrictID) REFERENCES District(DistrictID)
);

CREATE TABLE IF NOT EXISTS AuditLog (
    LogID      INT PRIMARY KEY AUTO_INCREMENT,
    UserID     INT,
    Action     VARCHAR(100) NOT NULL,
    TableName  VARCHAR(100),
    RecordID   INT,
    OldValue   JSON,
    NewValue   JSON,
    IPAddress  VARCHAR(50),
    CreatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES FOR SEARCH PERFORMANCE
-- ─────────────────────────────────────────────────────────────

CREATE INDEX idx_casemaster_station    ON CaseMaster(PoliceStationID);
CREATE INDEX idx_casemaster_date       ON CaseMaster(CrimeRegisteredDate);
CREATE INDEX idx_casemaster_status     ON CaseMaster(CaseStatusID);
CREATE INDEX idx_casemaster_crimehead  ON CaseMaster(CrimeMajorHeadID);
CREATE INDEX idx_accused_name          ON Accused(AccusedName);
CREATE INDEX idx_victim_name           ON Victim(VictimName);
CREATE INDEX idx_monthly_stat          ON MonthlyCrimeStat(Year, Month, UnitID);
CREATE INDEX idx_hotspot_district      ON CrimeHotspot(DistrictID);
