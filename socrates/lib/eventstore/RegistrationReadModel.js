/*eslint no-underscore-dangle: 0*/
'use strict';

var R = require('ramda');
var moment = require('moment-timezone');

var beans = require('simple-configure').get('beans');
var e = beans.get('eventConstants');
var socratesConstants = beans.get('socratesConstants');
var SoCraTesReadModel = beans.get('SoCraTesReadModel');

function RegistrationReadModel(eventStore) {
  this._eventStore = eventStore;

  // read model state:
  this._reservationsBySessionId = undefined;
  this._waitinglistReservationsBySessionId = undefined;
  this._participantsByMemberId = undefined;
  this._waitinglistParticipantsByMemberId = undefined;
}

var updateReservationsBySessionId = function (reservationsBySessionId, event) {
  var earliestValidRegistrationTime = moment.tz().subtract(socratesConstants.registrationPeriodinMinutes, 'minutes');
  if (event.event === e.RESERVATION_WAS_ISSUED && moment(event.timestamp).isAfter(earliestValidRegistrationTime)) {
    reservationsBySessionId[event.sessionID] = event;
  }
  if (event.event === e.PARTICIPANT_WAS_REGISTERED) {
    delete reservationsBySessionId[event.sessionID];
  }
  return reservationsBySessionId;
};

RegistrationReadModel.prototype.reservationsBySessionId = function () {
  if (!this._reservationsBySessionId) {
    this._reservationsBySessionId = R.reduce(updateReservationsBySessionId, {}, this._eventStore.registrationEvents());
  }
  return this._reservationsBySessionId;
};

RegistrationReadModel.prototype.reservationsBySessionIdFor = function (roomType) {
  return R.filter(function (event) { return event.roomType === roomType; }, this.reservationsBySessionId());
};

var updateParticipantsByMemberId = function (participantsByMemberId, event) {
  if (event.event === e.PARTICIPANT_WAS_REGISTERED || event.event === e.ROOM_TYPE_WAS_CHANGED || event.event === e.DURATION_WAS_CHANGED) {
    participantsByMemberId[event.memberId] = event;
  }
  return participantsByMemberId;
};

RegistrationReadModel.prototype.participantsByMemberId = function () {
  if (!this._participantsByMemberId) {
    this._participantsByMemberId = R.reduce(updateParticipantsByMemberId, {}, this._eventStore.registrationEvents());
  }
  return this._participantsByMemberId;
};

RegistrationReadModel.prototype.participantsByMemberIdFor = function (roomType) {
  return R.filter(function (event) { return event.roomType === roomType; }, this.participantsByMemberId());
};

RegistrationReadModel.prototype.participantEventFor = function (memberId) {
  return this.participantsByMemberId()[memberId];
};

RegistrationReadModel.prototype.isAlreadyRegistered = function (memberId) {
  return !!this.participantEventFor(memberId);
};


RegistrationReadModel.prototype.reservationsAndParticipantsFor = function (roomType) {
  return R.concat(R.values(this.reservationsBySessionIdFor(roomType)), R.values(this.participantsByMemberIdFor(roomType)));
};

var updateWaitinglistReservationsBySessionId = function (waitinglistReservationsBySessionId, event) {
  var thirtyMinutesAgo = moment.tz().subtract(30, 'minutes');
  if (event.event === e.WAITINGLIST_RESERVATION_WAS_ISSUED && moment(event.timestamp).isAfter(thirtyMinutesAgo)) {
    waitinglistReservationsBySessionId[event.sessionID] = event;
  }
  if (event.event === e.WAITINGLIST_PARTICIPANT_WAS_REGISTERED || event.event === e.PARTICIPANT_WAS_REGISTERED) {
    delete waitinglistReservationsBySessionId[event.sessionID];
  }
  return waitinglistReservationsBySessionId;
};

RegistrationReadModel.prototype.waitinglistReservationsBySessionId = function () {
  if (!this._waitinglistReservationsBySessionId) {
    this._waitinglistReservationsBySessionId = R.reduce(updateWaitinglistReservationsBySessionId, {}, this._eventStore.registrationEvents());
  }
  return this._waitinglistReservationsBySessionId;
};

RegistrationReadModel.prototype.waitinglistReservationsBySessionIdFor = function (roomType) {
  return R.filter(function (event) { return R.contains(roomType, event.desiredRoomTypes); }, this.waitinglistReservationsBySessionId());
};

var updateWaitinglistParticipantsByMemberId = function (waitinglistParticipantsByMemberId, event) {
  if (event.event === e.WAITINGLIST_PARTICIPANT_WAS_REGISTERED) {
    waitinglistParticipantsByMemberId[event.memberId] = event;
  }
  if (event.event === e.PARTICIPANT_WAS_REGISTERED) {
    delete waitinglistParticipantsByMemberId[event.memberId];
  }
  return waitinglistParticipantsByMemberId;
};

RegistrationReadModel.prototype.waitinglistParticipantsByMemberId = function () {
  if (!this._waitinglistParticipantsByMemberId) {
    this._waitinglistParticipantsByMemberId = R.reduce(updateWaitinglistParticipantsByMemberId, {}, this._eventStore.registrationEvents());
  }
  return this._waitinglistParticipantsByMemberId;
};

RegistrationReadModel.prototype.waitinglistParticipantsByMemberIdFor = function (roomType) {
  return R.filter(function (event) { return R.contains(roomType, event.desiredRoomTypes); }, this.waitinglistParticipantsByMemberId());
};

RegistrationReadModel.prototype.isFull = function (roomType) {
  return new SoCraTesReadModel(this._eventStore).quotaFor(roomType) <= this.reservationsAndParticipantsFor(roomType).length;
};

RegistrationReadModel.prototype._reservationOrWaitinglistReservationEventFor = function (sessionId) {
  return this.reservationsBySessionId()[sessionId] || this.waitinglistReservationsBySessionId()[sessionId];
};

function expirationTimeOf(event) {
  return moment(event.timestamp).add(socratesConstants.registrationPeriodinMinutes, 'minutes');
}


RegistrationReadModel.prototype.reservationExpiration = function (sessionId) {
  var event = this._reservationOrWaitinglistReservationEventFor(sessionId);
  return event && expirationTimeOf(event);
};

RegistrationReadModel.prototype.hasValidReservationFor = function (sessionId) {
  return !!this._reservationOrWaitinglistReservationEventFor(sessionId);
};

RegistrationReadModel.prototype.waitinglistParticipantEventFor = function (memberId) {
  return this.waitinglistParticipantsByMemberId()[memberId];
};

RegistrationReadModel.prototype.selectedOptionFor = function (memberID) {
  var participantEvent = this.participantEventFor(memberID);
  if (participantEvent) {
    return participantEvent.roomType + ',' + participantEvent.duration;
  }

  var waitinglistParticipantEvent = this.waitinglistParticipantEventFor(memberID);
  if (waitinglistParticipantEvent) {
    return waitinglistParticipantEvent.desiredRoomTypes[0] + ',waitinglist'; // TODO improve UX! Show all selected waitinglist options.
  }
  return null;
};

RegistrationReadModel.prototype.roomTypesOf = function (memberID) {
  var participantEvent = this._participantEventFor(memberID);
  if (participantEvent) {
    return [participantEvent.roomType];
  }

  var waitinglistParticipantEvent = this.waitinglistParticipantEventFor(memberID);
  if (waitinglistParticipantEvent) {
    return waitinglistParticipantEvent.desiredRoomTypes;
  }
  return [];
};

// TODO this is currently for tests only...:
RegistrationReadModel.prototype.waitinglistReservationsAndParticipantsFor = function (roomType) {
  return R.concat(R.values(this.waitinglistReservationsBySessionIdFor(roomType)), R.values(this.waitinglistParticipantsByMemberIdFor(roomType)));
};


module.exports = RegistrationReadModel;