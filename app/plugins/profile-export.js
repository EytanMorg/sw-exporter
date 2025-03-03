const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const sanitize = require('sanitize-filename');
const dateformat = require('date-fns');
const MISSING_DATA_ERROR =
  'No file created. Data was missing during the Export process. This happens sometimes, when com2us failes to include important data during the request. Normally this fixes itself after a few tries.';

module.exports = {
  defaultConfig: {
    enabled: true,
    sortData: true,
    mergeStorage: true,
    timestampedCopy: false,
  },
  defaultConfigDetails: {
    sortData: { label: 'Sort data like ingame' },
    mergeStorage: { label: 'Merge sealed monster storage into profile data' },
    timestampedCopy: { label: 'Timestamped copy in separate folder' },
  },
  pluginName: 'ProfileExport',
  pluginDescription: 'Exports your monster and rune data.',
  temp: {},
  init(proxy, config) {
    proxy.on('HubUserLogin', (req, resp) => {
      if (config.Config.Plugins[this.pluginName].enabled) {
        if (!this.checkData(resp)) {
          return proxy.log({ type: 'error', source: 'plugin', name: this.pluginName, message: MISSING_DATA_ERROR });
        }
        if (config.Config.Plugins[this.pluginName].sortData) {
          resp = this.sortUserData(resp);
        }

        this.temp[resp.wizard_info.wizard_id] = resp;

        if (!config.Config.Plugins[this.pluginName].mergeStorage) {
          this.writeProfileToFile(proxy, resp.wizard_info.wizard_id);
        }

        if (config.Config.Plugins[this.pluginName].timestampedCopy) {
          this.writeProfileToFolder(proxy, resp.wizard_info.wizard_id);
        }
      }
    });
    proxy.on('GuestLogin', (req, resp) => {
      if (config.Config.Plugins[this.pluginName].enabled) {
        if (!this.checkData(resp)) {
          return proxy.log({ type: 'error', source: 'plugin', name: this.pluginName, message: MISSING_DATA_ERROR });
        }
        if (config.Config.Plugins[this.pluginName].sortData) {
          resp = this.sortUserData(resp);
        }

        this.temp[resp.wizard_info.wizard_id] = resp;

        if (!config.Config.Plugins[this.pluginName].mergeStorage) {
          this.writeProfileToFile(proxy, resp.wizard_info.wizard_id);
        }
      }
    });
    // will leave this for now for legacy purposes
    proxy.on('getUnitStorageList', (req, resp) => {
      if (config.Config.Plugins[this.pluginName].enabled && config.Config.Plugins[this.pluginName].mergeStorage) {
        if (this.temp[req.wizard_id]) {
          this.temp[req.wizard_id] = { ...this.temp[req.wizard_id], unit_storage_list: resp.unit_storage_list };
          this.writeProfileToFile(proxy, req.wizard_id);
        }
      }
    });
    proxy.on('GetWizardDataPart1', (req, resp) => {
      if (config.Config.Plugins[this.pluginName].enabled && config.Config.Plugins[this.pluginName].mergeStorage) {
        if (this.temp[req.wizard_id]) {
          this.temp[req.wizard_id] = { ...this.temp[req.wizard_id], unit_storage_list: resp.GetUnitStorageList?.unit_storage_list };
          this.writeProfileToFile(proxy, req.wizard_id);
          // remove temp so it won't create a new file when opening the shrine again
          delete this.temp[req.wizard_id];
        }
      }
    });
  },
  writeProfileToFile(proxy, wizardID) {
    const timestamp = dateformat.format(new Date(), 'yyyy-MM-dd_HHmmss');
    const wizardName = this.temp[wizardID].wizard_info.wizard_name;
    const filename = sanitize(`${wizardName}-${wizardID}`).concat('.json');

    let outFile = fs.createWriteStream(path.join(config.Config.App.filesPath, filename), {
      flags: 'w',
      autoClose: true,
    });

    outFile.write(JSON.stringify(this.temp[wizardID], true, 2));
    outFile.end();
    proxy.log({ type: 'success', source: 'plugin', name: this.pluginName, message: 'Saved profile data to '.concat(filename) });
  },

  writeProfileToFolder(proxy, wizardID) {
    const wizardName = this.temp[wizardID].wizard_info.wizard_name;
    const timestamp = dateformat.format(new Date(), 'yyyy-MM-dd_HHmmss');
    const filename = sanitize(`${wizardName}-${wizardID}-${timestamp}`).concat('.json');

    fse.ensureDirSync(path.join(config.Config.App.filesPath, 'profile saves'));
    let outFile = fs.createWriteStream(path.join(config.Config.App.filesPath, 'profile saves', filename), {
      flags: 'w',
      autoClose: true,
    });

    outFile.write(JSON.stringify(this.temp[wizardID], true, 2));
    outFile.end();
    proxy.log({ type: 'success', source: 'plugin', name: this.pluginName, message: 'Saved profile data to '.concat(filename) });
  },
  checkData(data) {
    // Sometimes com2us doesn't include al lthe required data in the request
    // Most notably is the missing of the building_list object.
    // So lets return false if it's undefined
    if (!data.building_list) {
      return false;
    }
    return true;
  },
  sortUserData(data) {
    // get storage building id
    let storageID;
    for (let building of data.building_list) {
      if (building.building_master_id === 25) {
        storageID = building.building_id;
      }
    }
    // generic sort function
    cmp = function (x, y) {
      return x > y ? 1 : x < y ? -1 : 0;
    };

    // sort monsters
    data.unit_list = data.unit_list.sort((a, b) =>
      cmp(
        [
          cmp(a.building_id === storageID ? 1 : 0, b.building_id === storageID ? 1 : 0),
          -cmp(a.class, b.class),
          -cmp(a.unit_level, b.unit_level),
          cmp(a.attribute, b.attribute),
          cmp(a.unit_id, b.unit_id),
        ],
        [
          cmp(b.building_id === storageID ? 1 : 0, a.building_id === storageID ? 1 : 0),
          -cmp(b.class, a.class),
          -cmp(b.unit_level, a.unit_level),
          cmp(b.attribute, a.attribute),
          cmp(b.unit_id, a.unit_id),
        ]
      )
    );

    // sort runes on monsters
    for (let monster of data.unit_list) {
      // make sure that runes is actually an array (thanks com2us)
      if (monster.runes === Object(monster.runes)) {
        monster.runes = Object.values(monster.runes);
      }

      monster.runes = monster.runes.sort((a, b) => cmp([cmp(a.slot_no, b.slot_no)], [cmp(b.slot_no, a.slot_no)]));
    }

    // make sure that runes is actually an array (thanks again com2us)
    if (data.runes === Object(data.runes)) {
      data.runes = Object.values(data.runes);
    }

    // sort runes in inventory
    data.runes = data.runes.sort((a, b) =>
      cmp([cmp(a.set_id, b.set_id), cmp(a.slot_no, b.slot_no)], [cmp(b.set_id, a.set_id), cmp(b.slot_no, a.slot_no)])
    );

    // sort crafts
    data.rune_craft_item_list = data.rune_craft_item_list.sort((a, b) =>
      cmp(
        [cmp(a.craft_type, b.craft_type), cmp(a.craft_item_id, b.craft_item_id)],
        [cmp(b.craft_type, a.craft_type), cmp(b.craft_item_id, a.craft_item_id)]
      )
    );

    return data;
  },
};
