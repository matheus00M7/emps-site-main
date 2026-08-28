-- Esquema MySQL 8 fornecido para o projeto EMPS.
-- Mantido como referência original; o backend atual usa a tradução Prisma/PostgreSQL
-- em backend/prisma para evitar dois bancos concorrentes.

CREATE DATABASE emps_db
DEFAULT CHARACTER SET utf8mb4
DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE emps_db;

CREATE TABLE users(
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
full_name VARCHAR(100) NOT NULL,
email VARCHAR(255) NOT NULL UNIQUE,
password_hash VARCHAR(255) NOT NULL,
role ENUM('admin', 'customer') NOT NULL DEFAULT 'customer',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)ENGINE = InnoDB;
CREATE TABLE stations(
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
admin_id INT UNSIGNED NOT NULL,
station_name VARCHAR(50) NOT NULL,
postal_code CHAR(8) NOT NULL,
street VARCHAR(80) NOT NULL,
address_number VARCHAR(20) NOT NULL,
complement VARCHAR(80),
neighborhood VARCHAR(80) NOT NULL,
city VARCHAR(80) NOT NULL,
state CHAR(2) NOT NULL,
country_code CHAR(2) NOT NULL DEFAULT 'BR',
latitude DECIMAL(10,8),
longitude DECIMAL(11,8),
geocoding_status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
power_limit_kw DECIMAL(10,2),
status ENUM('pending', 'active', 'inactive', 'maintenance') NOT NULL DEFAULT 'pending',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_stations_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_stations_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
CONSTRAINT chk_stations_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
CONSTRAINT chk_stations_power_limit CHECK (power_limit_kw IS NULL OR power_limit_kw > 0)
)ENGINE = InnoDB;

CREATE TABLE chargers (
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
station_id INT UNSIGNED NOT NULL,
charger_code VARCHAR(50) NOT NULL UNIQUE,
charger_name VARCHAR(100) NOT NULL,
ocpp_identity VARCHAR(100) NOT NULL UNIQUE,
ocpp_version VARCHAR(20),
serial_number VARCHAR(100) UNIQUE,
manufacturer VARCHAR(100),
model VARCHAR(100),
firmware_version VARCHAR(50),
power_type ENUM('AC', 'DC'),
phase_count TINYINT UNSIGNED,
connector_type VARCHAR(50),
rated_max_power_kw DECIMAL(8,2),
configured_power_limit_kw DECIMAL(8,2),
administrative_status ENUM('pending', 'enabled', 'disabled', 'maintenance') NOT NULL DEFAULT 'pending',
provisioned_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_chargers_station (station_id),
CONSTRAINT fk_chargers_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_chargers_phase_count CHECK (phase_count IS NULL OR phase_count IN (1, 3)),
CONSTRAINT chk_chargers_rated_power CHECK (rated_max_power_kw IS NULL OR rated_max_power_kw > 0),
CONSTRAINT chk_chargers_power_limit CHECK (configured_power_limit_kw IS NULL OR (configured_power_limit_kw > 0 AND (rated_max_power_kw IS NULL OR configured_power_limit_kw <= rated_max_power_kw)))
) ENGINE = InnoDB;

CREATE TABLE charger_live_status (
charger_id INT UNSIGNED NOT NULL PRIMARY KEY,
operational_status ENUM('unknown','available', 'preparing', 'charging', 'suspended', 'finishing', 'reserved', 'unavailable', 'faulted', 'offline') NOT NULL DEFAULT 'unknown',
current_power_kw DECIMAL(10,3) NOT NULL DEFAULT 0.000,
meter_total_kwh DECIMAL(14,3),
voltage_v DECIMAL(8,2),
current_a DECIMAL(8,2),
last_error_code VARCHAR(100),
last_seen_at DATETIME,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_live_status_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_live_current_power CHECK(current_power_kw >=0),
CONSTRAINT chk_live_meter_total CHECK(meter_total_kwh IS NULL OR meter_total_kwh >=0),
CONSTRAINT chk_live_voltage CHECK(voltage_v IS NULL OR voltage_v >=0),
CONSTRAINT chk_live_current CHECK(current_a IS NULL OR current_a >=0)
)ENGINE = InnoDB;
