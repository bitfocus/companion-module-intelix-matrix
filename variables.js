module.exports = async function (self) {

	let variables = [
		{
			name: 'Front Panel Keys Lock',
			variableId: 'lock_state'
		},
		{
			name: 'Title Label',
			variableId: 'title_label'
		},
		{
			name: 'LCD Readout 1',
			variableId: 'lcd_readout_1'
		},
		{
			name: 'LCD Readout 2',
			variableId: 'lcd_readout_2'
		},
	]

	const totalInputs = parseInt(self.config.model)
	for (let index = 0; index < totalInputs; index++) {
		variables.push({
			name: `Output ${index + 1}`,
			variableId: `output_${index + 1}`
		})
	}

	// set the input names
	for (let index = 0; index < totalInputs; index++) {
		variables.push({
			name: `Input ${index + 1} name`,
			variableId: `input_${index + 1}_label`
		})
	}
	// set the output names
	for (let index = 0; index < totalInputs; index++) {
		variables.push({
			name: `Output ${index + 1} name`,
			variableId: `output_${index + 1}_label`
		})
	}

	// set the HDCP info
	for (let index = 0; index < totalInputs; index++) {
		variables.push({
			name: `Input ${index + 1} HDCP`,
			variableId: `input_${index + 1}_hdcp`
		})
	}

	self.setVariableDefinitions(variables)


	self.setVariableValues({'lock_state': ''})
	const inputVariables = {}
	for (let index = 0; index < totalInputs; index++) {
		inputVariables[`output_${index + 1}`] = ''
		inputVariables[`input_${index + 1}_label`] = `Input ${index + 1}`
		inputVariables[`output_${index + 1}_label`] = `Output ${index + 1}`
	}
	self.setVariableValues(inputVariables)
}
