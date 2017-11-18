
function GameUtils() {

}

var gameUtils = new GameUtils();

module.exports = gameUtils;

var tempResource = require("models/Pos");
var Pos = tempResource.Pos;
var createPosFromJson = tempResource.createPosFromJson;

var entityList = require("models/Entity").entityList;
var Player = require("models/Player").Player;

var classUtils = require("utils/class.js");
var accountUtils = require("utils/account.js");
var chunkUtils = require("utils/chunk.js");

var framesPerSecond = 20;
var hasStopped = false;
var maximumPlayerCount = 15;
var persistDelay = 60 * framesPerSecond;
var isPersistingEverything = false;

GameUtils.prototype.getPlayerByUsername = function(username) {
    var index = 0;
    while (index < entityList.length) {
        var tempEntity = entityList[index];
        if (classUtils.isInstanceOf(tempEntity, Player)) {
            if (tempEntity.username == username) {
                return tempEntity;
            }
        }
        index += 1;
    }
    return null;
}

GameUtils.prototype.performUpdate = function(username, commandList, done) {
    if (hasStopped) {
        done({
            success: false,
            message: "The server is scheduled to shut down. Please come back later."
        });
        return;
    }
    var tempPlayer;
    var tempCommandList;
    var index = 0;
    function startProcessingCommands() {
        var tempDate = new Date();
        tempPlayer.lastActivityTime = tempDate.getTime();
        tempCommandList = [];
        index = 0;
        processNextCommand();
    }
    function processNextCommand() {
        if (isPersistingEverything) {
            setTimeout(processNextCommand, 100);
            return;
        }
        while (true) {
            if (index >= commandList.length) {
                done({
                    success: true,
                    commandList: tempCommandList
                });
                return;
            }
            var tempCommand = commandList[index];
            index += 1;
            if (tempCommand.commandName == "startPlaying") {
                performStartPlayingCommand(tempCommand, tempPlayer, tempCommandList, processNextCommand);
                return;
            }
            if (tempCommand.commandName == "getTiles") {
                performGetTilesCommand(tempCommand, tempPlayer, tempCommandList);
            }
            if (tempCommand.commandName == "walk") {
                performWalkCommand(tempCommand, tempPlayer, tempCommandList);
            }
            if (tempCommand.commandName == "assertPos") {
                performAssertPosCommand(tempCommand, tempPlayer, tempCommandList);
            }
            if (tempCommand.commandName == "getEntities") {
                performGetEntitiesCommand(tempCommand, tempPlayer, tempCommandList);
            }
        }
    }
    tempPlayer = gameUtils.getPlayerByUsername(username);
    if (tempPlayer === null) {
        var tempCount = 0;
        var index = 0;
        while (index < entityList.length) {
            var tempEntity = entityList[index];
            if (classUtils.isInstanceOf(tempEntity, Player)) {
                tempCount += 1;
            }
            index += 1;
        }
        if (tempCount >= maximumPlayerCount) {
            done({
                success: false,
                message: "The server has reached maximum player capacity. Please come back later."
            });
            return;
        }
        accountUtils.acquireLock(function() {
            accountUtils.findAccountByUsername(username, function(error, index, result) {
                accountUtils.releaseLock();
                if (error) {
                    reportDatabaseErrorWithJson(error, res);
                    return;
                }
                tempPlayer = new Player(result);
                startProcessingCommands();
            });
        });
    } else {
        startProcessingCommands();
    }
}

function addSetLocalPlayerInfoCommand(account, player, commandList) {
    commandList.push({
        commandName: "setLocalPlayerInfo",
        username: account.username,
        avatar: account.avatar,
        // TODO: Populate this value.
        breadCount: 0
    });
}

function addSetTilesCommand(pos, size, tileList, commandList) {
    commandList.push({
        commandName: "setTiles",
        pos: pos.toJson(),
        tileList: tileList,
        size: size
    });
}

function addSetLocalPlayerPosCommand(player, commandList) {
    commandList.push({
        commandName: "setLocalPlayerPos",
        pos: player.pos.toJson(),
    });
}

function addRemoveAllEntitiesCommand(commandList) {
    commandList.push({
        commandName: "removeAllEntities"
    });
}

function addAddEntityCommand(entity, commandList) {
    commandList.push({
        commandName: "addEntity",
        entityInfo: entity.getClientInfo()
    });
}

function performStartPlayingCommand(command, player, commandList, done) {
    accountUtils.acquireLock(function() {
        accountUtils.findAccountByUsername(player.username, function(error, index, result) {
            accountUtils.releaseLock();
            if (error) {
                reportDatabaseErrorWithJson(error, res);
                return;
            }
            addSetLocalPlayerInfoCommand(result, player, commandList);
            done();
        });
    });
}

function performGetTilesCommand(command, player, commandList) {
    var tempPos = createPosFromJson(command.pos);
    var tempSize = command.size;
    if (tempSize > 50) {
        return;
    }
    var tempTileList = chunkUtils.getTiles(tempPos, tempSize);
    addSetTilesCommand(tempPos, tempSize, tempTileList, commandList);
}

function performWalkCommand(command, player, commandList) {
    player.walk(command.direction);
}

function performAssertPosCommand(command, player, commandList) {
    var tempPos = createPosFromJson(command.pos);
    if (!player.pos.equals(tempPos)) {
        addSetLocalPlayerPosCommand(player, commandList);
    }
}

function performGetEntitiesCommand(command, player, commandList) {
    addRemoveAllEntitiesCommand(commandList);
    var index = 0;
    while (index < entityList.length) {
        var tempEntity = entityList[index];
        var tempRadius = 40;
        if (tempEntity.pos.x > player.pos.x - tempRadius && tempEntity.pos.x < player.pos.x + tempRadius
                && tempEntity.pos.y > player.pos.y - tempRadius && tempEntity.pos.y < player.pos.y + tempRadius) {
            if (tempEntity != player) {
                addAddEntityCommand(tempEntity, commandList);
            }
        }
        index += 1;
    }
}

GameUtils.prototype.persistEverything = function(done) {
    console.log("Saving world state...");
    isPersistingEverything = true;
    chunkUtils.persistAllChunks();
    var index = 0;
    function persistNextEntity() {
        while (true) {
            if (index >= entityList.length) {
                isPersistingEverything = false;
                console.log("Saved world state.");
                done();
                return;
            }
            var tempEntity = entityList[index];
            index += 1;
            if (classUtils.isInstanceOf(tempEntity, Player)) {
                tempEntity.persist(persistNextEntity);
                return;
            }
        }
    }
    persistNextEntity();
}

GameUtils.prototype.stopGame = function(done) {
    hasStopped = true;
    this.persistEverything(done);
}

function gameTimerEvent() {
    if (hasStopped || isPersistingEverything) {
        return;
    }
    var index = entityList.length - 1;
    while (index >= 0) {
        var tempEntity = entityList[index];
        tempEntity.tick();
        index -= 1;
    }
    persistDelay -= 1;
    if (persistDelay <= 0) {
        persistDelay = 60 * framesPerSecond;
        gameUtils.persistEverything(function() {
            // Do nothing.
        });
    }
}

setInterval(gameTimerEvent, 1000 / framesPerSecond);
