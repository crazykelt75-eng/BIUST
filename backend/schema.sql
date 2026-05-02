-- Use the database
USE railway;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    id_number VARCHAR(20) UNIQUE,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
);

-- Motshelo Groups table
CREATE TABLE IF NOT EXISTS motshelo_groups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_name VARCHAR(100) NOT NULL,
    group_code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    monthly_contribution DECIMAL(10,2) DEFAULT 1000.00,
    target_interest DECIMAL(10,2) DEFAULT 5000.00,
    interest_rate DECIMAL(5,2) DEFAULT 20.00,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_group_code (group_code)
);

-- Group Members table
CREATE TABLE IF NOT EXISTS group_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('admin', 'signatory', 'member') DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE KEY unique_group_member (group_id, user_id),
    INDEX idx_group_role (group_id, role)
);

-- Monthly Contributions table
CREATE TABLE IF NOT EXISTS contributions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_id INT NOT NULL,
    member_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    month_year DATE NOT NULL,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    proof_of_payment_url VARCHAR(255),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    initiated_by INT NOT NULL,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    UNIQUE KEY unique_member_month (member_id, month_year)
);

-- Loans table
CREATE TABLE IF NOT EXISTS loans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_id INT NOT NULL,
    member_id INT NOT NULL,
    principal_amount DECIMAL(10,2) NOT NULL,
    outstanding_balance DECIMAL(10,2) NOT NULL,
    interest_accrued DECIMAL(10,2) DEFAULT 0.00,
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status ENUM('pending', 'approved', 'active', 'paid', 'rejected', 'defaulted') DEFAULT 'pending',
    purpose TEXT,
    approved_by_1 INT,
    approved_by_2 INT,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status)
);

-- Loan Repayments table
CREATE TABLE IF NOT EXISTS loan_repayments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    loan_id INT NOT NULL,
    member_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    proof_of_payment_url VARCHAR(255),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    initiated_by INT NOT NULL,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status)
);

-- Show all tables created
SHOW TABLES;