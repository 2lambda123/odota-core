import * as actions from '../actions';
var initialState = {
  content: {
    data: {}
  },
  metadata: {
    data: {
      navbar_pages: {},
      match_pages: {},
      player_pages: {},
      player_fields: {},
      cheese: null,
      user: null,
      banner: null,
    }
  },
};

export default (state = initialState, action) => {
  switch (action.type) {
    case actions.METADATA:
      return Object.assign({}, state, {
        metadata: {
          isFetching: !Boolean(action.data),
          data: action.data || state.metadata.data
        }
      });
    case actions.MATCH:
    case actions.PLAYER:
      return Object.assign(
      {}, state,
      {
        content:
        {
          isFetching: !Boolean(action.data),
          data: action.data || state.content.data
        }
      });
    default:
      //unrecognized action, return original state
      return state;
  }
}
