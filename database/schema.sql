IF DB_ID(N'UsdtRialChart') IS NULL
    CREATE DATABASE UsdtRialChart;
GO
USE UsdtRialChart;
GO

IF OBJECT_ID('dbo.Exchanges', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Exchanges (
        ExchangeId INT IDENTITY(1,1) PRIMARY KEY,
        Code NVARCHAR(30) NOT NULL UNIQUE,
        DisplayName NVARCHAR(80) NOT NULL,
        IsEnabled BIT NOT NULL CONSTRAINT DF_Exchanges_IsEnabled DEFAULT 1,
        LastSuccessAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Exchanges_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID('dbo.ExchangeCandles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ExchangeCandles (
        ExchangeCandleId BIGINT IDENTITY(1,1) PRIMARY KEY,
        ExchangeId INT NOT NULL,
        Timeframe VARCHAR(10) NOT NULL,
        CandleTime DATETIME2(0) NOT NULL,
        [Open] DECIMAL(28,8) NOT NULL,
        High DECIMAL(28,8) NOT NULL,
        Low DECIMAL(28,8) NOT NULL,
        [Close] DECIMAL(28,8) NOT NULL,
        Volume DECIMAL(28,8) NOT NULL CONSTRAINT DF_ExchangeCandles_Volume DEFAULT 0,
        QuoteVolume DECIMAL(28,8) NULL,
        IsHistorical BIT NOT NULL CONSTRAINT DF_ExchangeCandles_Historical DEFAULT 0,
        ReceivedAt DATETIME2(3) NOT NULL CONSTRAINT DF_ExchangeCandles_Received DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_ExchangeCandles_Exchanges FOREIGN KEY (ExchangeId) REFERENCES dbo.Exchanges(ExchangeId),
        CONSTRAINT UQ_ExchangeCandles UNIQUE (ExchangeId, Timeframe, CandleTime)
    );
    CREATE INDEX IX_ExchangeCandles_Timeframe_Time ON dbo.ExchangeCandles(Timeframe, CandleTime DESC);
END;
GO

IF OBJECT_ID('dbo.MarketCandles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MarketCandles (
        MarketCandleId BIGINT IDENTITY(1,1) PRIMARY KEY,
        Timeframe VARCHAR(10) NOT NULL,
        CandleTime DATETIME2(0) NOT NULL,
        [Open] DECIMAL(28,8) NOT NULL,
        High DECIMAL(28,8) NOT NULL,
        Low DECIMAL(28,8) NOT NULL,
        [Close] DECIMAL(28,8) NOT NULL,
        Volume DECIMAL(28,8) NOT NULL CONSTRAINT DF_MarketCandles_Volume DEFAULT 0,
        SourceCount INT NOT NULL,
        IsPartial BIT NOT NULL CONSTRAINT DF_MarketCandles_Partial DEFAULT 0,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_MarketCandles_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_MarketCandles UNIQUE (Timeframe, CandleTime)
    );
    CREATE INDEX IX_MarketCandles_Timeframe_Time ON dbo.MarketCandles(Timeframe, CandleTime DESC);
END;
GO

IF OBJECT_ID('dbo.ExchangeTicks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ExchangeTicks (
        TickId BIGINT IDENTITY(1,1) PRIMARY KEY,
        ExchangeId INT NOT NULL,
        ExternalTradeId NVARCHAR(120) NULL,
        TradeTime DATETIME2(3) NOT NULL,
        PriceRial DECIMAL(28,8) NOT NULL,
        Quantity DECIMAL(28,12) NOT NULL,
        Side VARCHAR(10) NULL,
        ReceivedAt DATETIME2(3) NOT NULL CONSTRAINT DF_ExchangeTicks_Received DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_ExchangeTicks_Exchanges FOREIGN KEY (ExchangeId) REFERENCES dbo.Exchanges(ExchangeId)
    );
    CREATE INDEX IX_ExchangeTicks_Exchange_Time ON dbo.ExchangeTicks(ExchangeId, TradeTime DESC);
END;
GO

MERGE dbo.Exchanges AS target
USING (VALUES
    (N'wallex', N'والکس'),
    (N'nobitex', N'نوبیتکس'),
    (N'bitpin', N'بیت‌پین')
) AS source(Code, DisplayName)
ON target.Code = source.Code
WHEN NOT MATCHED THEN INSERT (Code, DisplayName) VALUES (source.Code, source.DisplayName);
GO
