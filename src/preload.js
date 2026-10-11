const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  listWorlds: call('worlds:list'),
  currentWorld: call('worlds:current'),
  openWorld: call('worlds:open'),
  closeWorld: call('worlds:close'),
  createWorld: call('worlds:create'),
  updateWorld: call('worlds:update'),
  deleteWorld: call('worlds:delete'),
  pickWorldImage: call('worlds:pickImage'),

  listEntries: call('entries:list'),
  getEntry: call('entries:get'),
  createEntry: call('entries:create'),
  updateEntry: call('entries:update'),
  deleteEntry: call('entries:delete'),
  backlinks: call('entries:backlinks'),
  meta: call('meta:get'),

  importImagePaths: call('images:importPaths'),
  importImageBuffer: call('images:importBuffer'),
  pickImages: call('images:pick'),
  updateImage: call('images:update'),
  deleteImage: call('images:delete'),
  // Dropped File objects no longer expose .path; Electron resolves it here.
  pathForFile: file => webUtils.getPathForFile(file),

  addRelation: call('relations:add'),
  updateRelation: call('relations:update'),
  deleteRelation: call('relations:delete'),

  graph: call('graph:get'),
  saveGraphPositions: call('graph:savePositions'),
  reorderTimeline: call('timeline:reorder'),

  saveBoardPositions: call('board:savePositions'),
  boardNotes: call('board:notes'),
  createBoardNote: call('board:createNote'),
  updateBoardNote: call('board:updateNote'),
  deleteBoardNote: call('board:deleteNote'),

  openDataFolder: call('app:openDataFolder'),
  backup: call('app:backup'),
});
