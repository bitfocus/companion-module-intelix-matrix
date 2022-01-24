const tcp = require('../../tcp')
const instance_skel = require('../../instance_skel')
const fetch = require('node-fetch')

class instance extends instance_skel {
	/**
	 * Create an instance of the module
	 *
	 * @param {EventEmitter} system - the brains of the operation
	 * @param {string} id - the instance ID
	 * @param {Object} config - saved user configuration parameters
	 * @since 1.0.0
	 */
	constructor(system, id, config) {
		super(system, id, config)

		this.matrixInfo = {}
		this.CHOICES_INPUTS = []
		this.CHOICES_OUTPUTS = []
		this.actions() // export actions
		this.init_presets() // export presets
	}

	updateConfig(config) {
		this.init_presets()

		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.config = config

		this.init_tcp()
        this.getMatrixInfo()
        this.init_variables()
        this.init_feedbacks()
	}

	init() {
		this.init_tcp()
		this.getMatrixInfo()
        this.init_variables()
        this.init_feedbacks()
        this.init_presets()
	}

	init_tcp() {
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.status(this.STATE_WARNING, 'Connecting')

		if (this.config.host) {
			this.socket = new tcp(this.config.host, 4001)

			this.socket.on('status_change', (status, message) => {
				this.status(status, message)
			})

			this.socket.on('error', (err) => {
				this.debug('Network error', err)
				this.status(this.STATE_ERROR, err)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('connect', () => {
				this.status(this.STATE_OK)
				this.debug('Connected')

				// get model info
				this.socket.send(Buffer.from(`/*Type;\r\n`, 'utf8'))
			})

			this.socket.on('data', (data) => {
				const buf = Buffer.from(data)
				// might need to split the lines
				const response = buf.toString().split(/\r?\n/)
				response.forEach((each) => this.parseData(each))
			})
		}
	}

	// Return config fields for web config
	config_fields() {
		return [
			{
				type: 'text',
				id: 'info',
				label: 'Information',
				width: 12,
				value: `
				This should automatically pull your model but you can specify which model you have.
			`
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 6,
				regex: this.REGEX_IP
			},
			{
				type: 'dropdown',
				label: 'Model',
				id: 'model',
				default: '4',
				choices: [
					{
						id: '4',
						label: 'INT-44HDX'
					},
					{
						id: '6',
						label: 'INT-66HDX'
					},
					{
						id: '8',
						label: 'INT-88HDX'
					}
				]
			}
		]
	}

	// When module gets deleted
	destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
		}

		this.debug('destroy', this.id)
	}

	init_presets() {
		let presets = []
		this.setPresetDefinitions(presets)
	}

	actions(system) {
		this.setupChoices()

		this.system.emit('instance_actions', this.id, {
			routeAll: {
				label: 'Route input x to all video outputs',
				options: [
					{
						type: 'dropdown',
						label: 'Input',
						id: 'id_inputALL',
						default: '1',
						tooltip: 'Which input would you like sent to All outputs?',
						choices: this.CHOICES_INPUTS,
						minChoicesForSearch: 0
					}
				]
			},
			routeInd: {
				label: 'Route input x to audio and video output y',
				options: [
					{
						type: 'dropdown',
						label: 'Input',
						id: 'id_input',
						default: '1',
						tooltip: 'Which input would you like sent to a specific output?',
						choices: this.CHOICES_INPUTS,
						minChoicesForSearch: 0
					},
					{
						type: 'multiselect',
						label: 'Output',
						id: 'id_output',
						default: '1',
						tooltip: 'Which output?',
						choices: this.CHOICES_OUTPUTS,
						minChoicesForSearch: 0
					}
				]
			},
			routeThrough: {
				label: 'Route inputs to corresponding video outputs'
			},
			lockPanel: {
				label: 'Lock the front panel keys'
			},
			unlockPanel: {
				label: 'Unlock the front panel keys'
			}
		})
	}

	action(action) {
		let cmd
		const end = '\r\n'

		switch (action.action) {
			case 'routeAll':
				this.parseVariables(action.options.id_inputAll, (value) => {
					cmd = `${value}All.`
				})
				break
			case 'routeInd':
				this.parseVariables(action.options.id_input, (value) => {
					if (action.options.id_output.length !== 0) {
						const outputs = action.options.id_output.join(',')
						cmd = `${value}B${outputs}.`
					}
				})
				break
			case 'routeThrough':
				cmd = `All#.`
				break
			case 'lockPanel':
				cmd = `/%Lock;`
				break
			case 'unlockPanel':
				cmd = `/%Unlock;`
				break
		}

		/*
     * create a binary buffer pre-encoded 'latin1' (8bit no change bytes)
     * sending a string assumes 'utf8' encoding
     * which then escapes character values over 0x7F
     * and destroys the 'binary' content
     */
		let sendBuf = Buffer.from(cmd + end, 'latin1')

		if (sendBuf != '') {
			this.debug('sending ', sendBuf, 'to', this.config.host)

			if (this.socket !== undefined && this.socket.connected) {
				this.socket.send(sendBuf)
			} else {
				this.debug('Socket not connected :(')
			}
		}
	}

	init_variables() {
		let variables = [
			{
				label: 'Front Panel Keys Lock',
				name: 'lock_state'
			}
		]

		const totalInputs = parseInt(this.config.model)
		for (let index = 0; index < totalInputs; index++) {
			variables.push({
				label: `Output ${index + 1}`,
				name: `output_${index + 1}`
			})
		}

		// set the input labels
		for (let index = 0; index < totalInputs; index++) {
			variables.push({
				label: `Input ${index + 1} Label`,
				name: `input_${index + 1}_label`
			})
		}
		// set the output labels
		for (let index = 0; index < totalInputs; index++) {
			variables.push({
				label: `Output ${index + 1} Label`,
				name: `output_${index + 1}_label`
			})
		}

		this.setVariableDefinitions(variables)

		this.setVariable('lock_state', '')
		for (let index = 0; index < totalInputs; index++) {
			this.setVariable(`output_${index + 1}`, '')
			this.setVariable(`input_${index + 1}_label`, `Input ${index + 1}`)
			this.setVariable(`output_${index + 1}_label`, `Output ${index + 1}`)
		}
	}

	init_feedbacks() {
		// feedbacks
		const feedbacks = {}
		let self = this

		feedbacks['output_has_input'] = {
			label: 'Output has a specific input.',
			type: 'boolean',
			description: 'If an output has a specific input, set the button to this color.',
			style: {
				// The default style change for a boolean feedback
				// The user will be able to customise these values as well as the fields that will be changed
				color: this.rgb(0, 0, 0),
				bgcolor: this.rgb(255, 0, 0)
			},
			// options is how the user can choose the condition the feedback activates for
			options: [
				{
					type: 'dropdown',
					label: 'Input',
					id: 'input',
					default: 1,
					choices: this.CHOICES_INPUTS
				},
				{
					type: 'dropdown',
					label: 'Output',
					id: 'output',
					default: 1,
					choices: this.CHOICES_OUTPUTS
				}
			],
			callback: function(feedback) {
				// This callback will be called whenever companion wants to check if this feedback is 'active' and should affect the button style
				try {
					if (self.matrixInfo[`CH${feedback.options.output}Output`] == feedback.options.input) {
						return true
					} else {
						return false
					}
				} catch (error) {
					this.log('error', 'Feedback error: ' + error.message)
					return false
				}
			}
		}

		this.setFeedbackDefinitions(feedbacks)
	}

	setupChoices() {
		const totalInputs = parseInt(this.config.model)
		this.CHOICES_INPUTS = []
		this.CHOICES_OUTPUTS = []

		if (this.matrixInfo['admpassword'] !== undefined) {
			for (let index = 0; index < totalInputs; index++) {
				this.CHOICES_INPUTS.push({
					id: `${index + 1}`,
					label: this.matrixInfo[`Input${index + 1}Table`]
				})
				this.CHOICES_OUTPUTS.push({
					id: `${index + 1}`,
					label: this.matrixInfo[`Output${index + 1}Table`]
				})
			}
		} else {
			for (let index = 0; index < totalInputs; index++) {
				this.CHOICES_INPUTS.push({
					id: `${index + 1}`,
					label: `Input ${index + 1}`
				})
				this.CHOICES_OUTPUTS.push({
					id: `${index + 1}`,
					label: `Output ${index + 1}`
				})
			}
		}
	}

	async getMatrixInfo() {
		const model = this.config.model + this.config.model
		const body = {
			tag: 'ptn'
		}

		try {
			const response = await fetch(`http://${this.config.host}/cgi-bin/MUH${model}TP_getsetparams.cgi`, {
				method: 'post',
				body: JSON.stringify(body),
				headers: {
					'Content-Type': 'application/json'
				}
			})
			const dataText = await response.text()

			const data = JSON.parse(dataText.substring(2, dataText.length - 1).replace(/'/g, '"'))
			this.matrixInfo = data
			this.actions()
			this.init_feedbacks()
			this.checkFeedbacks('output_has_input')

			const totalInputs = parseInt(this.config.model)
			for (let index = 0; index < totalInputs; index++) {
				this.setVariable(`output_${index + 1}`, data[`CH${index + 1}Output`])
				this.setVariable(`input_${index + 1}_label`, data[`Input${index + 1}Table`])
				this.setVariable(`output_${index + 1}_label`, data[`Output${index + 1}Table`])
			}

			if (data.LockKey) {
				this.setVariable('lock_state', 'Unlocked')
			} else {
				this.setVariable('lock_state', 'Locked')
			}
		} catch (error) {
			this.log('error', 'Network error: ' + error.message)
			console.error(error)
		}
	}

	parseData(data) {
		// Get model info INT-66HDX
		if (data.substring(0, 3) === 'INT') {
			this.config.model = data.substring(5, 6)
			// this.setVariable('model', data.substring(0, 9))
			this.saveConfig()
			return
		}
		// Get Version
		if (data.substring(0, 1) === 'V') {
			this.setVariable('version', data)
			return
		}
		// Get if system front panel is locked System Locked!
		if (data.substring(0, 6) === 'System') {
			if (data.substring(7, 8) === 'L') {
				this.setVariable('lock_state', 'Locked')
			} else {
				this.setVariable('lock_state', 'Unlocked')
			}
			this.checkFeedbacks()
			return
		}
		// Get Status of individual output AV:  2-> 2 AV: input-> output
		if (data.substring(0, 2) === 'AV') {
			//AV:  3-> 1
			if (data.trim().length === 10) {
				const i = data.substring(5, 6)
				const o = data.substring(9, 10)
				this.setVariable(`output_${o}`, i)
				this.checkFeedbacks()
			} else {
				// get everything because we missed something
				this.getMatrixInfo()
			}
			return
		}
		// Process switch command 4 To All
		const firstChar = data.substring(0, 1)
		const totalInputs = parseInt(this.config.model)
		if (firstChar >= '0' && firstChar <= '8') {
			// Process All
			if (data.substring(5, 8) === 'All') {
				for (let index = 0; index < totalInputs; index++) {
					this.setVariable(`output_${index + 1}`, firstChar)
					this.checkFeedbacks()
				}
				return
			} else if (data.substring(1, 2 === 'B')) {
				// xBy
				const input = data.substring(0, 1)
				const output = data.substring(2, 3)
				this.setVariable(`output_${output}`, input)
				this.checkFeedbacks()
				return
			}
		}
		// Process All through // All Through.
		if (data.substring(0, 5) === 'All T') {
			for (let index = 0; index < totalInputs; index++) {
				this.setVariable(`output_${index + 1}`, index + 1)
				this.checkFeedbacks()
			}
			return
		}

		// if nothing matches but this was triggered then get everything just in case
		this.getMatrixInfo()
	}
}
exports = module.exports = instance
