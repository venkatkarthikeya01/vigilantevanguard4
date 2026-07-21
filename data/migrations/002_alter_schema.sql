-- ============================================================
-- VigilanteVanguard — Migration 002
-- Adds missing junction table and FK from ER diagram
-- Run AFTER 001_initial_schema.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Junction table: ArrestSurrender ↔ Accused (many-to-many)
--    ER doc calls this inv_arrestsurrenderaccused
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_arrestsurrenderaccused (
    ID                INT PRIMARY KEY AUTO_INCREMENT,
    ArrestSurrenderID INT NOT NULL,
    AccusedMasterID   INT NOT NULL,
    FOREIGN KEY (ArrestSurrenderID) REFERENCES ArrestSurrender(ArrestSurrenderID),
    FOREIGN KEY (AccusedMasterID)   REFERENCES Accused(AccusedMasterID)
);

CREATE INDEX idx_asa_arrest  ON inv_arrestsurrenderaccused(ArrestSurrenderID);
CREATE INDEX idx_asa_accused ON inv_arrestsurrenderaccused(AccusedMasterID);

-- ─────────────────────────────────────────────────────────────
-- 2. Add missing FK: ArrestSurrender.ArrestSurrenderStateId → State
--    (was defined in table but FK constraint was omitted in 001)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ArrestSurrender
    ADD CONSTRAINT fk_arrest_state
    FOREIGN KEY (ArrestSurrenderStateId) REFERENCES State(StateID);

-- ─────────────────────────────────────────────────────────────
-- 3. Additional useful indexes missed in 001
-- ─────────────────────────────────────────────────────────────
CREATE INDEX idx_casemaster_crimeno    ON CaseMaster(CrimeNo);
CREATE INDEX idx_casemaster_category   ON CaseMaster(CaseCategoryID);
CREATE INDEX idx_casemaster_latlon     ON CaseMaster(Latitude, Longitude);
CREATE INDEX idx_arrest_date           ON ArrestSurrender(ArrestSurrenderDate);
CREATE INDEX idx_arrest_accused        ON ArrestSurrender(AccusedMasterID);
CREATE INDEX idx_complainant_case      ON ComplainantDetails(CaseMasterID);
CREATE INDEX idx_victim_case           ON Victim(CaseMasterID);
CREATE INDEX idx_accused_case          ON Accused(CaseMasterID);
CREATE INDEX idx_chargesheet_case      ON ChargesheetDetails(CaseMasterID);
CREATE INDEX idx_actsection_case       ON ActSectionAssociation(CaseMasterID);
CREATE INDEX idx_actsection_act        ON ActSectionAssociation(ActID, SectionID);
CREATE INDEX idx_monthly_head          ON MonthlyCrimeStat(CrimeHeadCode, Year, Month);
CREATE INDEX idx_employee_unit         ON Employee(UnitID);
CREATE INDEX idx_employee_district     ON Employee(DistrictID);
CREATE INDEX idx_unit_district         ON Unit(DistrictID);
CREATE INDEX idx_court_district        ON Court(DistrictID);
CREATE INDEX idx_crimesubhead_head     ON CrimeSubHead(CrimeHeadID);
CREATE INDEX idx_section_act           ON Section(ActCode);
CREATE INDEX idx_crimeheadact_head     ON CrimeHeadActSection(CrimeHeadID);
